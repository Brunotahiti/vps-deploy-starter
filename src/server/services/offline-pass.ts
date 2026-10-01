/**
 * Connexion par PIN sans internet.
 *
 * Le serveur ne garde jamais le PIN en clair. Quand il le voit passer (connexion par PIN, autorisation manager,
 * PIN défini par un manager), il en dérive une clé (PBKDF2-SHA256, sel propre à l'établissement) et la conserve.
 * Chaque terminal enregistré reçoit, pour chaque employé, un « laissez-passer » chiffré avec cette clé :
 * hors ligne, la tablette dérive la même clé du PIN saisi et ouvre le laissez-passer. Un mauvais PIN n'ouvre rien
 * (chiffrement authentifié AES-GCM). Le jeton qu'il contient authentifie les opérations rejouées au retour du réseau
 * (en-tête X-Offline-Pass), sur ce terminal seulement, jusqu'à son expiration ou un changement de PIN.
 *
 * Limite assumée : comme pour toute caisse qui fonctionne hors ligne, quelqu'un qui extrairait les données
 * de la tablette pourrait tenter tous les PIN hors ligne. La dérivation lente, le lien au terminal,
 * l'expiration et la révocation au changement de PIN en limitent la portée.
 */
import { createCipheriv, pbkdf2, randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { prisma } from "@/server/db";
import { randomToken, sha256 } from "@/server/auth/password";

const pbkdf2Async = promisify(pbkdf2);

/** Paramètres partagés avec la tablette (WebCrypto) : toute modification invalide les laissez-passer existants. */
export const OFFLINE_KDF = { iterations: 210_000, hash: "SHA-256" as const, keyLength: 32 };
export const offlineSalt = (establishmentId: string) => `manaresto-offline:${establishmentId}`;
const PASS_TTL_MS = 14 * 86_400_000;
const RENEW_AFTER_MS = 86_400_000; // réémis chaque jour (droits à jour) ; l'ancien reste valide pour les opérations déjà en file

export function deriveOfflineKey(pin: string, establishmentId: string) {
  return pbkdf2Async(pin, offlineSalt(establishmentId), OFFLINE_KDF.iterations, OFFLINE_KDF.keyLength, "sha256");
}

/** Établissements où l'employé peut se connecter par PIN. */
async function establishmentsOf(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { isOwner: true, organizationId: true, memberships: { select: { establishmentId: true } } } });
  if (!u) return [];
  if (u.isOwner) return (await prisma.establishment.findMany({ where: { organizationId: u.organizationId }, select: { id: true } })).map((e) => e.id);
  return u.memberships.map((m) => m.establishmentId);
}

/** PIN vu en clair lors d'une connexion ou d'une autorisation : la clé est créée si elle manque. */
export async function rememberOfflineKey(userId: string, establishmentId: string, pin: string) {
  const exists = await prisma.offlinePinKey.findUnique({ where: { userId_establishmentId: { userId, establishmentId } }, select: { userId: true } });
  if (exists) return;
  const key = await deriveOfflineKey(pin, establishmentId);
  await prisma.offlinePinKey.upsert({ where: { userId_establishmentId: { userId, establishmentId } }, create: { userId, establishmentId, key }, update: { key } });
}

/**
 * PIN défini ou changé : anciennes clés et laissez-passer révoqués, nouvelles clés pour tous les établissements
 * de l'employé. PIN retiré : plus de connexion hors ligne.
 */
export async function resetOfflineKeys(userId: string, pin: string | null) {
  await prisma.offlinePinKey.deleteMany({ where: { userId } });
  await prisma.offlinePass.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  if (!pin) return;
  for (const establishmentId of await establishmentsOf(userId)) {
    await prisma.offlinePinKey.create({ data: { userId, establishmentId, key: await deriveOfflineKey(pin, establishmentId) } });
  }
}

/** Compte désactivé, retiré d'un établissement… : ses laissez-passer (de cet établissement, ou tous) ne valent plus rien. */
export async function revokeOfflinePasses(userId: string, establishmentIds?: string[]) {
  const scope = establishmentIds ? { establishmentId: { in: establishmentIds } } : {};
  await prisma.offlinePinKey.deleteMany({ where: { userId, ...scope } });
  await prisma.offlinePass.updateMany({ where: { userId, revokedAt: null, ...scope }, data: { revokedAt: new Date() } });
}

export type OfflinePassPayload = {
  token: string;
  userId: string;
  firstName: string;
  lastName: string;
  displayName: string | null;
  color: string | null;
  isOwner: boolean;
  roleKey: string | null;
  permissions: string[];
  expiresAt: string;
};
export type SealedPass = { userId: string; iv: string; data: string } | { userId: string; keep: true };

function seal(key: Buffer, payload: OfflinePassPayload) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final(), cipher.getAuthTag()]); // format WebCrypto : chiffré + tag
  return { iv: iv.toString("base64"), data: ct.toString("base64") };
}

/**
 * Laissez-passer des employés de l'établissement pour ce terminal. Ceux émis depuis moins d'un jour sont conservés
 * tels quels sur la tablette (`keep`) ; les autres sont (ré)émis. La liste complète remplace celle de la tablette.
 */
export async function issueOfflinePasses(terminal: { id: string; establishmentId: string }) {
  const establishmentId = terminal.establishmentId;
  const est = await prisma.establishment.findUniqueOrThrow({ where: { id: establishmentId }, select: { organizationId: true } });
  const keys = await prisma.offlinePinKey.findMany({
    where: {
      establishmentId,
      user: { isActive: true, pinHash: { not: null }, OR: [{ memberships: { some: { establishmentId } } }, { isOwner: true, organizationId: est.organizationId }] },
    },
    include: { user: { include: { memberships: { where: { establishmentId }, include: { role: { include: { permissions: true } } } } } } },
  });
  const now = Date.now();
  const current = await prisma.offlinePass.findMany({ where: { terminalId: terminal.id, revokedAt: null, createdAt: { gt: new Date(now - RENEW_AFTER_MS) } }, select: { userId: true } });
  const keep = new Set(current.map((p) => p.userId));
  const passes: SealedPass[] = [];
  for (const k of keys) {
    if (keep.has(k.userId)) { passes.push({ userId: k.userId, keep: true }); continue; }
    const u = k.user;
    const m = u.memberships[0];
    const token = randomToken(32);
    const expiresAt = new Date(now + PASS_TTL_MS);
    await prisma.offlinePass.create({ data: { userId: u.id, establishmentId, terminalId: terminal.id, tokenHash: sha256(token), expiresAt } });
    const payload: OfflinePassPayload = {
      token, userId: u.id, firstName: u.firstName, lastName: u.lastName, displayName: u.displayName, color: u.color, isOwner: u.isOwner,
      roleKey: u.isOwner ? "owner" : (m?.role.key ?? null), permissions: u.isOwner ? ["*"] : (m?.role.permissions.map((p) => p.permissionKey) ?? []),
      expiresAt: expiresAt.toISOString(),
    };
    passes.push({ userId: u.id, ...seal(Buffer.from(k.key), payload) });
  }
  // Ménage : laissez-passer expirés de ce terminal
  await prisma.offlinePass.deleteMany({ where: { terminalId: terminal.id, expiresAt: { lt: new Date(now - 86_400_000) } } });
  return { establishmentId, kdf: { iterations: OFFLINE_KDF.iterations, hash: OFFLINE_KDF.hash, salt: offlineSalt(establishmentId) }, passes };
}

/** Jeton présenté au rejeu : valide, sur ce terminal, employé actif. Retourne le laissez-passer, sinon null. */
export async function findOfflinePass(token: string, terminalId: string) {
  const pass = await prisma.offlinePass.findUnique({ where: { tokenHash: sha256(token) }, include: { user: { include: { organization: { select: { blockedAt: true } } } } } });
  if (!pass || pass.terminalId !== terminalId || pass.revokedAt || pass.expiresAt < new Date() || !pass.user.isActive || pass.user.organization.blockedAt) return null;
  return pass;
}
