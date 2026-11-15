import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { deleteShift, listShifts, staffSummary, upsertEmployee, upsertShift } from "@/server/services/staff";
import { deleteAbsence, deleteShiftTemplate, listAbsences, listShiftTemplates, mondayOf, saveWeekAsTemplate, upsertAbsence, upsertShiftTemplate } from "@/server/services/planning";
import { addDays, formatTime, localDay } from "@/lib/dates";

const TZ = "Pacific/Tahiti";
let T: Awaited<ReturnType<typeof makeTenant>>;
let teva: string, hina: string, moana: string;
let w1: string, w2: string, w3: string; // lundis des trois semaines à venir
const week = (monday: string) => listShifts(T.est.id, monday, addDays(monday, 6), TZ);
const hhmm = (d: Date) => formatTime(d, TZ);

beforeAll(async () => {
  await resetDb();
  T = await makeTenant("planning");
  teva = (await upsertEmployee(T.managerActor, { firstName: "Teva", lastName: "Tane", jobTitle: "Serveur" })).id;
  hina = (await upsertEmployee(T.managerActor, { firstName: "Hina", lastName: "Vahine", jobTitle: "Cuisinière" })).id;
  moana = (await upsertEmployee(T.managerActor, { firstName: "Moana", lastName: "Roa" })).id;
  w1 = addDays(mondayOf(localDay(new Date(), TZ)), 7);
  w2 = addDays(w1, 7);
  w3 = addDays(w2, 7);
});

describe("Planning : semaine type saisie une fois", () => {
  it("remplit toute seule les semaines suivantes, sans doublon, y compris un service de nuit", async () => {
    await upsertShiftTemplate(T.managerActor, { employeeId: teva, weekday: 0, startTime: "11:00", endTime: "15:00", notes: "Midi" });
    await upsertShiftTemplate(T.managerActor, { employeeId: teva, weekday: 4, startTime: "18:00", endTime: "23:30" });
    await upsertShiftTemplate(T.managerActor, { employeeId: hina, weekday: 5, startTime: "22:00", endTime: "02:00" });
    expect((await listShiftTemplates(T.est.id)).map((t) => `${t.weekday} ${t.startTime}`)).toEqual(["0 11:00", "4 18:00", "5 22:00"]);

    const first = await week(w1);
    expect(first).toHaveLength(3);
    expect(first.every((s) => s.templateId)).toBe(true);
    const monday = first.find((s) => s.employeeId === teva && localDay(s.startsAt, TZ) === w1)!;
    expect([hhmm(monday.startsAt), hhmm(monday.endsAt), monday.notes]).toEqual(["11:00", "15:00", "Midi"]);
    const night = first.find((s) => s.employeeId === hina)!;
    expect(localDay(night.startsAt, TZ)).toBe(addDays(w1, 5));
    expect(localDay(night.endsAt, TZ)).toBe(addDays(w1, 6)); // finit le lendemain
    expect((night.endsAt.getTime() - night.startsAt.getTime()) / 3600_000).toBe(4);

    expect(await week(w1)).toHaveLength(3); // rouvrir la semaine ne double rien
    expect(await week(w2)).toHaveLength(3);
  });

  it("un service supprimé à la main ne revient pas, un service déjà saisi n'est pas doublé", async () => {
    const night = (await week(w1)).find((s) => s.employeeId === hina)!;
    await deleteShift(T.managerActor, night.id);
    expect(await week(w1)).toHaveLength(2);

    // Semaine 3 : Teva a déjà un service le lundi à 10 h (saisi avant que la semaine ne soit remplie)
    const tz = (h: string) => new Date(`${w3}T${h}:00-10:00`).toISOString();
    await upsertShift(T.managerActor, { employeeId: teva, startsAt: tz("10:00"), endsAt: tz("14:00") });
    const third = await week(w3);
    expect(third.filter((s) => s.employeeId === teva && localDay(s.startsAt, TZ) === w3)).toHaveLength(1);
    expect(third).toHaveLength(3);
  });

  it("congés : les services de l'employé sont signalés à remplacer et ne comptent plus dans les heures prévues", async () => {
    const before = await staffSummary(T.est.id, w2, addDays(w2, 6), TZ);
    expect(before.rows.find((r) => r.id === teva)!.plannedHours).toBe(9.5); // 4 h + 5 h 30

    const abs = await upsertAbsence(T.managerActor, { employeeId: teva, startsOn: w2, endsOn: addDays(w2, 2), kind: "LEAVE", notes: "Vacances" });
    expect(abs.shiftsToCover).toBe(1); // le lundi midi
    expect((await listAbsences(T.est.id, w2, addDays(w2, 6))).map((a) => a.employee.firstName)).toEqual(["Teva"]);

    const shifts = await week(w2);
    const mondayShift = shifts.find((s) => localDay(s.startsAt, TZ) === w2)!;
    expect(mondayShift.absence).toEqual({ kind: "LEAVE", label: "Congés" });
    expect(shifts.find((s) => localDay(s.startsAt, TZ) === addDays(w2, 4))!.absence).toBeNull(); // vendredi : de retour

    const during = await staffSummary(T.est.id, w2, addDays(w2, 6), TZ);
    expect(during.rows.find((r) => r.id === teva)!.plannedHours).toBe(5.5);

    // Remplacement par Moana : le service garde la trace de l'employé prévu au départ
    await upsertShift(T.managerActor, { id: mondayShift.id, employeeId: moana, startsAt: mondayShift.startsAt.toISOString(), endsAt: mondayShift.endsAt.toISOString(), notes: mondayShift.notes });
    const replaced = (await week(w2)).find((s) => s.id === mondayShift.id)!;
    expect(replaced.employee.firstName).toBe("Moana");
    expect(replaced.replacesEmployee?.firstName).toBe("Teva");
    expect(replaced.isEdited).toBe(true);
    expect(replaced.absence).toBeNull();
    expect((await staffSummary(T.est.id, w2, addDays(w2, 6), TZ)).rows.find((r) => r.id === moana)!.plannedHours).toBe(4);

    // Le service revient à Teva : plus de remplacement
    await upsertShift(T.managerActor, { id: mondayShift.id, employeeId: teva, startsAt: mondayShift.startsAt.toISOString(), endsAt: mondayShift.endsAt.toISOString() });
    expect((await week(w2)).find((s) => s.id === mondayShift.id)!.replacesEmployee).toBeNull();
    await upsertShift(T.managerActor, { id: mondayShift.id, employeeId: moana, startsAt: mondayShift.startsAt.toISOString(), endsAt: mondayShift.endsAt.toISOString() });

    await deleteAbsence(T.managerActor, abs.id);
    expect(await listAbsences(T.est.id, w2, addDays(w2, 6))).toHaveLength(0);
  });

  it("modifier la semaine type met à jour les services à venir, sauf ceux retouchés à la main", async () => {
    const friday = (await listShiftTemplates(T.est.id)).find((t) => t.weekday === 4)!;
    await upsertShiftTemplate(T.managerActor, { id: friday.id, employeeId: teva, weekday: 4, startTime: "17:00", endTime: "22:00" });
    for (const w of [w1, w2, w3]) {
      const fri = (await week(w)).filter((s) => localDay(s.startsAt, TZ) === addDays(w, 4));
      expect(fri.map((s) => `${hhmm(s.startsAt)}-${hhmm(s.endsAt)}`)).toEqual(["17:00-22:00"]);
    }
    // Le lundi remplacé (retouché) reste à Moana ; le samedi supprimé à la main ne revient pas
    expect((await week(w2)).find((s) => localDay(s.startsAt, TZ) === w2)!.employee.firstName).toBe("Moana");
    expect((await week(w1)).some((s) => s.employeeId === hina)).toBe(false);

    // Supprimer une ligne retire ses services à venir non retouchés
    const r = await deleteShiftTemplate(T.managerActor, friday.id);
    expect(r.removedShifts).toBe(3);
    expect((await week(w1)).some((s) => localDay(s.startsAt, TZ) === addDays(w1, 4))).toBe(false);
  });

  it("« Garder cette semaine comme semaine type » reprend la semaine affichée", async () => {
    const tz = (d: string, h: string) => new Date(`${d}T${h}:00-10:00`).toISOString();
    const w4 = addDays(w3, 7);
    await upsertShift(T.managerActor, { employeeId: moana, startsAt: tz(addDays(w3, 2), "07:00"), endsAt: tz(addDays(w3, 2), "12:00"), notes: "Ouverture" });
    const res = await saveWeekAsTemplate(T.managerActor, w3);
    expect(res.lines).toBe((await week(w3)).length);
    const templates = await listShiftTemplates(T.est.id);
    expect(templates.some((t) => t.employee.firstName === "Moana" && t.weekday === 2 && t.startTime === "07:00" && t.endTime === "12:00" && t.notes === "Ouverture")).toBe(true);
    expect(await week(w3)).toHaveLength(res.lines); // pas de doublon sur la semaine reprise
    const next = await week(w4);
    expect(next).toHaveLength(res.lines);
    expect(next.some((s) => s.employeeId === moana && localDay(s.startsAt, TZ) === addDays(w4, 2))).toBe(true);
  });

  it("refuse les saisies incohérentes et reste cloisonné par établissement", async () => {
    await expect(upsertShiftTemplate(T.managerActor, { employeeId: teva, weekday: 7, startTime: "10:00", endTime: "12:00" })).rejects.toMatchObject({ code: "BAD_DAY" });
    await expect(upsertShiftTemplate(T.managerActor, { employeeId: teva, weekday: 1, startTime: "25:00", endTime: "12:00" })).rejects.toMatchObject({ code: "BAD_TIME" });
    await expect(upsertShiftTemplate(T.managerActor, { employeeId: teva, weekday: 1, startTime: "06:00", endTime: "05:00" })).rejects.toMatchObject({ code: "BAD_RANGE" }); // 23 h
    await expect(upsertAbsence(T.managerActor, { employeeId: teva, startsOn: w2, endsOn: w1 })).rejects.toMatchObject({ code: "BAD_RANGE" });
    await expect(saveWeekAsTemplate(T.managerActor, addDays(w1, 1))).rejects.toMatchObject({ code: "BAD_DAY" });
    await expect(saveWeekAsTemplate(T.managerActor, addDays(w1, 70))).rejects.toMatchObject({ code: "EMPTY_WEEK" });
    const other = await makeTenant("planning-autre");
    await expect(upsertShiftTemplate(other.managerActor, { employeeId: teva, weekday: 1, startTime: "10:00", endTime: "12:00" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await listShiftTemplates(other.est.id)).toHaveLength(0);
    expect(await prisma.planningWeek.count({ where: { establishmentId: other.est.id } })).toBe(0);
  });
});
