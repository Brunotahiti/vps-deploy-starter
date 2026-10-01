"use client";

/**
 * Connexion par PIN sans internet (voir src/server/services/offline-pass.ts).
 * La tablette garde les laissez-passer chiffrés des employés ; le PIN saisi en dérive la clé (PBKDF2, WebCrypto)
 * et ouvre celui de son titulaire. Aucun PIN n'est stocké.
 */
import { api } from "@/lib/api-client";
import type { Me } from "@/hooks/use-session";
import { cacheGet, cacheSet } from "./db";
import { setActivePassState, type ActivePass } from "./auth-state";
import { openSealedPass, type SealedPass as Sealed } from "./pass-crypto";
type Issued = {
  establishmentId: string;
  kdf: { iterations: number; hash: string; salt: string };
  passes: (Sealed | { userId: string; keep: true })[];
  establishment: NonNullable<Me["establishment"]>;
  terminal: NonNullable<Me["terminal"]>;
};
export type StoredPasses = Omit<Issued, "passes"> & { passes: Sealed[]; savedAt: number };

const PASSES = "offline-passes";
const ACTIVE = "offline-active";

export async function getStoredPasses() {
  return (await cacheGet<StoredPasses>(PASSES))?.data ?? null;
}

let lastSync = 0;
/** Met à jour les laissez-passer de ce terminal (toutes les 10 min au plus, sauf `force`). Sans effet hors terminal. */
export async function syncOfflinePasses(force = false) {
  if (!force && Date.now() - lastSync < 10 * 60_000) return;
  lastSync = Date.now();
  try {
    const issued = await api.get<Issued>("/api/auth/offline-passes");
    const prev = await getStoredPasses();
    const old = new Map((prev?.establishmentId === issued.establishmentId ? prev.passes : []).map((p) => [p.userId, p]));
    const passes = issued.passes.flatMap((p) => ("keep" in p ? (old.get(p.userId) ? [old.get(p.userId)!] : []) : [p]));
    await cacheSet(PASSES, { ...issued, passes, savedAt: Date.now() } satisfies StoredPasses);
  } catch { lastSync = 0; /* hors ligne ou appareil non enregistré : la dernière copie est conservée */ }
}

let failures = 0;
let lockedUntil = 0;

/**
 * Ouvre le laissez-passer correspondant au PIN. Retourne null si aucun ne s'ouvre (PIN inconnu de cette tablette).
 * Après 5 échecs consécutifs, 30 s d'attente.
 */
export async function unlockWithPin(pin: string): Promise<Omit<ActivePass, "mode"> | null> {
  if (Date.now() < lockedUntil) throw new Error("Trop de PIN erronés : patientez 30 secondes");
  const stored = await getStoredPasses();
  if (!stored) return null;
  const payload = await openSealedPass<Omit<ActivePass, "mode">>(pin, stored.kdf, stored.passes);
  if (payload && new Date(payload.expiresAt).getTime() > Date.now()) { failures = 0; return payload; }
  if (++failures >= 5) { failures = 0; lockedUntil = Date.now() + 30_000; }
  return null;
}

export async function loadActivePass() {
  const p = (await cacheGet<ActivePass>(ACTIVE))?.data ?? null;
  setActivePassState(p);
  return p;
}

export async function setActivePass(p: ActivePass | null) {
  setActivePassState(p);
  await cacheSet(ACTIVE, p);
}

/** Profil construit sans réseau pour l'employé connecté hors ligne. */
export function offlineMe(p: ActivePass, stored: StoredPasses): Me {
  const e = stored.establishment;
  return {
    user: { id: p.userId, email: "", firstName: p.firstName, lastName: p.lastName, displayName: p.displayName, color: p.color, isOwner: p.isOwner, hasPin: true },
    organizationId: e.organizationId,
    establishment: e,
    establishments: [{ id: e.id, name: e.name, slug: e.slug, roleKey: p.roleKey ?? "" }],
    roleKey: p.roleKey,
    permissions: p.permissions,
    terminal: stored.terminal,
    features: { email: false },
  };
}
