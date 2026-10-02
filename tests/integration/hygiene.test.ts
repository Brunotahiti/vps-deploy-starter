import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { lockedPermissions } from "@/lib/options";
import { SYSTEM_ROLES } from "@/lib/permissions";
import {
  closeTrace, createTrace, hygieneRegister, hygieneToday, listEquipment, markCleaningDone, recordReading, setupStarterPlan, upsertCleaningTask, upsertEquipment,
} from "@/server/services/hygiene";

let T: Awaited<ReturnType<typeof makeTenant>>;
// Heures de Tahiti (UTC−10) : 8 h = 18 h UTC, 15 h = 1 h UTC le lendemain
const tahiti = (day: string, hour: number) => new Date(new Date(`${day}T00:00:00Z`).getTime() + (hour + 10) * 3600_000);

beforeAll(async () => {
  await resetDb();
  T = await makeTenant("hygiene");
});

describe("Hygiène & HACCP", () => {
  it("option et droits : verrouillée sans l'option ; chef et gérant gèrent, l'équipe en salle enregistre", () => {
    expect(lockedPermissions(["stock"]).has("hygiene.record")).toBe(true);
    expect(lockedPermissions(["hygiene"]).has("hygiene.manage")).toBe(false);
    expect(SYSTEM_ROLES.kitchen.permissions).toEqual(expect.arrayContaining(["hygiene.record", "hygiene.manage"]));
    expect(SYSTEM_ROLES.server.permissions).toContain("hygiene.record");
    expect(SYSTEM_ROLES.server.permissions).not.toContain("hygiene.manage");
  });

  it("plan de départ : deux équipements aux plages usuelles et les nettoyages courants, une seule fois", async () => {
    expect(await setupStarterPlan(T.managerActor)).toEqual({ equipment: 2, tasks: 9 });
    expect(await setupStarterPlan(T.managerActor)).toEqual({ equipment: 0, tasks: 0 });
    const eq = await listEquipment(T.est.id);
    expect(eq.map((e) => [e.name, e.minTemp, e.maxTemp])).toEqual([["Réfrigérateur cuisine", 0, 4], ["Congélateur", -30, -18]]);
  });

  it("relevé hors limites : action corrective obligatoire, puis enregistré comme non conforme", async () => {
    const [frigo] = await listEquipment(T.est.id);
    const ok = await recordReading(T.actor, { equipmentId: frigo.id, value: 3.4 }, tahiti("2026-10-12", 8));
    expect(ok).toMatchObject({ value: 34, compliant: true, correctiveAction: null });
    await expect(recordReading(T.actor, { equipmentId: frigo.id, value: 7.5 }, tahiti("2026-10-12", 9))).rejects.toMatchObject({ status: 400, code: "CORRECTIVE_ACTION_REQUIRED" });
    const ko = await recordReading(T.actor, { equipmentId: frigo.id, value: 7.5, correctiveAction: "Porte mal fermée, refermée ; recontrôlé à 3 °C après 30 min" }, tahiti("2026-10-12", 9));
    expect(ko).toMatchObject({ value: 75, compliant: false });
    // Plage modifiable par le restaurant (ex. frigo à boissons)
    await upsertEquipment(T.managerActor, { id: frigo.id, name: "Réfrigérateur cuisine", kind: "FRIDGE", minTemp: 0, maxTemp: 3 });
    expect((await listEquipment(T.est.id))[0].maxTemp).toBe(3);
  });

  it("aujourd'hui : relevé du matin puis du soir, nettoyages du jour, de la semaine et du mois", async () => {
    const [frigo, congel] = await listEquipment(T.est.id);
    // Lundi 12 octobre, 10 h : le frigo est relevé ce matin, pas le congélateur
    let t = await hygieneToday(T.est.id, tahiti("2026-10-12", 10));
    expect(t.slot).toBe("MORNING");
    expect(t.equipment.find((e) => e.id === frigo.id)).toMatchObject({ morning: true, due: false, last: { value: 7.5, compliant: false } });
    expect(t.equipment.find((e) => e.id === congel.id)).toMatchObject({ morning: false, due: true, last: null });
    expect(t.counts).toMatchObject({ readingsDue: 1, cleaningDue: 9, issuesToday: 1 });
    // 15 h : place au relevé du soir
    t = await hygieneToday(T.est.id, tahiti("2026-10-12", 15));
    expect(t.slot).toBe("EVENING");
    expect(t.counts.readingsDue).toBe(2);

    const hotte = t.cleaning.find((c) => c.name === "Hotte et filtres")!;
    const sols = t.cleaning.find((c) => c.name === "Sols de la cuisine")!;
    await markCleaningDone(T.actor, hotte.id, null, tahiti("2026-10-12", 16));
    await markCleaningDone(T.actor, sols.id, "Dégraissant", tahiti("2026-10-12", 16));
    t = await hygieneToday(T.est.id, tahiti("2026-10-12", 17));
    expect(t.cleaning.find((c) => c.id === hotte.id)).toMatchObject({ due: false, lastBy: "Server h." });
    expect(t.cleaning.find((c) => c.id === sols.id)!.due).toBe(false);
    // Mercredi : les sols sont à refaire, la hotte (hebdomadaire) non ; lundi suivant : la hotte aussi
    t = await hygieneToday(T.est.id, tahiti("2026-10-14", 9));
    expect(t.cleaning.find((c) => c.id === sols.id)!.due).toBe(true);
    expect(t.cleaning.find((c) => c.id === hotte.id)!.due).toBe(false);
    t = await hygieneToday(T.est.id, tahiti("2026-10-19", 9));
    expect(t.cleaning.find((c) => c.id === hotte.id)!.due).toBe(true);
  });

  it("une tâche ajoutée au plan, une tâche archivée disparaît de la liste du jour", async () => {
    const vitres = await upsertCleaningTask(T.managerActor, { name: "Vitres de la terrasse", area: "Salle", frequency: "MONTHLY" });
    let t = await hygieneToday(T.est.id, tahiti("2026-10-14", 9));
    expect(t.cleaning.find((c) => c.id === vitres.id)).toMatchObject({ frequency: "MONTHLY", due: true });
    await upsertCleaningTask(T.managerActor, { id: vitres.id, name: "Vitres de la terrasse", frequency: "MONTHLY", isActive: false });
    t = await hygieneToday(T.est.id, tahiti("2026-10-14", 9));
    expect(t.cleaning.find((c) => c.id === vitres.id)).toBeUndefined();
  });

  it("traçabilité : préparation avec DLC à surveiller, réception refusée, produit utilisé ou jeté", async () => {
    const now = tahiti("2026-10-12", 11);
    const sauce = await createTrace(T.actor, { kind: "PREPARATION", name: "Sauce coco", quantity: "2 L", useBy: "2026-10-13" }, now);
    const thon = await createTrace(T.actor, { kind: "RECEPTION", name: "Thon rouge", supplierName: "Pêcherie de Papeete", lotNumber: "L2410", temperature: 1.8, useBy: "2026-10-14" }, now);
    await expect(createTrace(T.actor, { kind: "RECEPTION", name: "Crevettes", compliant: false }, now)).rejects.toMatchObject({ code: "ISSUE_REQUIRED" });
    const refus = await createTrace(T.actor, { kind: "RECEPTION", name: "Crevettes", compliant: false, temperature: 9, issue: "Reçues à 9 °C : refusées, reprises par le livreur" }, now);
    expect(refus.closedReason).toBe("DISCARDED");
    await expect(createTrace(T.actor, { kind: "PREPARATION", name: "Riz", useBy: "2026-10-01" }, now)).rejects.toMatchObject({ code: "BAD_DATE" });

    // Lundi : la sauce (DLC mardi) est à surveiller, pas encore le thon (mercredi)
    let t = await hygieneToday(T.est.id, now);
    expect(t.expiring.map((r) => [r.name, r.expired])).toEqual([["Sauce coco", false]]);
    // Mercredi matin : la sauce est périmée, le thon arrive à échéance
    t = await hygieneToday(T.est.id, tahiti("2026-10-14", 8));
    expect(t.expiring.map((r) => [r.name, r.expired])).toEqual([["Sauce coco", true], ["Thon rouge", false]]);
    expect(t.counts).toMatchObject({ expired: 1, expiringSoon: 1 });
    await closeTrace(T.actor, sauce.id, "DISCARDED", tahiti("2026-10-14", 8));
    await closeTrace(T.actor, thon.id, "USED", tahiti("2026-10-14", 9));
    t = await hygieneToday(T.est.id, tahiti("2026-10-14", 10));
    expect(t.expiring).toEqual([]);
  });

  it("registre : relevés, nettoyages, traçabilité et non-conformités de la période", async () => {
    const r = await hygieneRegister(T.est.id, "2026-10-12", "2026-10-14");
    expect(r.readings.map((x) => x.value)).toEqual([3.4, 7.5]); // dans l'ordre chronologique
    expect(r.cleaning.map((c) => c.task).sort()).toEqual(["Hotte et filtres", "Sols de la cuisine"]);
    expect(r.trace.map((x) => x.name)).toEqual(["Sauce coco", "Thon rouge", "Crevettes"]);
    expect(r.nonConformities.map((n) => n.what)).toEqual(["Réfrigérateur cuisine : 7,5 °C (limites 0 à 4 °C)", "Réception Crevettes"]);
    expect(r.nonConformities[0].action).toContain("Porte mal fermée");
    await expect(hygieneRegister(T.est.id, "2026-10-14", "2026-10-12")).rejects.toMatchObject({ code: "BAD_RANGE" });
    await expect(hygieneRegister(T.est.id, "2026-01-01", "2026-10-12")).rejects.toMatchObject({ code: "BAD_RANGE" });
  });

  it("chaque restaurant ne voit que ses équipements", async () => {
    const other = await makeTenant("hygiene-autre");
    const [frigo] = await listEquipment(T.est.id);
    await expect(recordReading(other.actor, { equipmentId: frigo.id, value: 3 })).rejects.toMatchObject({ status: 404 });
    expect(await prisma.hygieneEquipment.count({ where: { establishmentId: other.est.id } })).toBe(0);
  });
});
