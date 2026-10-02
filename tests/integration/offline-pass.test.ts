import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { sha256 } from "@/server/auth/password";
import { setUserPin } from "@/server/services/auth";
import { updateUser } from "@/server/services/users";
import { findOfflinePass, issueOfflinePasses, rememberOfflineKey, type OfflinePassPayload, type SealedPass } from "@/server/services/offline-pass";
import { openSealedPass, type SealedPass as Sealed } from "@/lib/offline/pass-crypto";

let T: Awaited<ReturnType<typeof makeTenant>>;
let terminal: { id: string; establishmentId: string };
let other: { id: string; establishmentId: string };

const sealed = (passes: SealedPass[]) => passes.filter((p): p is Sealed => "data" in p);

beforeAll(async () => {
  await resetDb();
  T = await makeTenant("offline-pass");
  terminal = await prisma.terminal.create({ data: { establishmentId: T.est.id, name: "Tablette salle", kind: "POS", deviceKeyHash: sha256("tablette-salle") } });
  other = await prisma.terminal.create({ data: { establishmentId: T.est.id, name: "Tablette bar", kind: "POS", deviceKeyHash: sha256("tablette-bar") } });
});

describe("connexion par PIN sans internet : laissez-passer chiffrés par le PIN", () => {
  it("aucun laissez-passer tant que le serveur n'a jamais vu le PIN en clair", async () => {
    expect((await issueOfflinePasses(terminal)).passes).toEqual([]);
  });

  it("le bon PIN ouvre le laissez-passer de son titulaire, un autre PIN n'ouvre rien", async () => {
    await rememberOfflineKey(T.server.id, T.est.id, "1001"); // connexion par PIN en ligne
    await rememberOfflineKey(T.manager.id, T.est.id, "2000"); // autorisation manager en ligne
    const issued = await issueOfflinePasses(terminal);
    expect(issued.passes.map((p) => p.userId).sort()).toEqual([T.server.id, T.manager.id].sort());
    // Jamais le PIN en clair : « 1001 » peut apparaître par hasard au milieu d'un identifiant ou d'un chiffré,
    // on cherche donc le PIN comme valeur isolée (ni entouré de caractères d'identifiant ni de base64)
    expect(JSON.stringify(issued)).not.toMatch(/(^|[^0-9A-Za-z+/=-])1001([^0-9A-Za-z+/=-]|$)/);

    const server = await openSealedPass<OfflinePassPayload>("1001", issued.kdf, sealed(issued.passes));
    expect(server?.userId).toBe(T.server.id);
    expect(server?.permissions).toContain("pos.use");
    expect(server?.permissions).not.toContain("pos.discount");
    const manager = await openSealedPass<OfflinePassPayload>("2000", issued.kdf, sealed(issued.passes));
    expect(manager?.permissions).toContain("pos.discount");
    expect(await openSealedPass("1234", issued.kdf, sealed(issued.passes))).toBeNull();

    // Le jeton authentifie les opérations rejouées, sur CE terminal seulement
    expect((await findOfflinePass(server!.token, terminal.id))?.userId).toBe(T.server.id);
    expect(await findOfflinePass(server!.token, other.id)).toBeNull();
  });

  it("réémis au plus une fois par jour : la tablette garde le sien, l'ancien jeton reste valide", async () => {
    const again = await issueOfflinePasses(terminal);
    expect(again.passes.every((p) => "keep" in p)).toBe(true);
    await prisma.offlinePass.updateMany({ where: { terminalId: terminal.id }, data: { createdAt: new Date(Date.now() - 2 * 86_400_000) } });
    const renewed = await issueOfflinePasses(terminal);
    expect(sealed(renewed.passes).length).toBe(2);
    expect(await prisma.offlinePass.count({ where: { terminalId: terminal.id, revokedAt: null } })).toBe(4);
  });

  it("changement de PIN : anciens laissez-passer révoqués, le nouveau PIN fonctionne aussitôt", async () => {
    const before = sealed((await issueOfflinePasses(other)).passes);
    const oldPass = await openSealedPass<OfflinePassPayload>("1001", (await issueOfflinePasses(other)).kdf, before);
    await setUserPin(T.server.id, "4826");
    expect(await findOfflinePass(oldPass!.token, other.id)).toBeNull();
    const issued = await issueOfflinePasses(other);
    expect(await openSealedPass("1001", issued.kdf, sealed(issued.passes))).toBeNull();
    const fresh = await openSealedPass<OfflinePassPayload>("4826", issued.kdf, sealed(issued.passes));
    expect(fresh?.userId).toBe(T.server.id);
    expect((await findOfflinePass(fresh!.token, other.id))?.userId).toBe(T.server.id);
  });

  it("compte désactivé : plus de laissez-passer ni de rejeu à son nom", async () => {
    await prisma.offlinePass.updateMany({ where: { terminalId: other.id }, data: { createdAt: new Date(Date.now() - 2 * 86_400_000) } });
    const issued = await issueOfflinePasses(other);
    const pass = await openSealedPass<OfflinePassPayload>("2000", issued.kdf, sealed(issued.passes));
    await updateUser(T.org.id, T.owner.id, T.manager.id, { isActive: false });
    expect(await findOfflinePass(pass!.token, other.id)).toBeNull();
    expect((await issueOfflinePasses(other)).passes.map((p) => p.userId)).not.toContain(T.manager.id);
  });
});
