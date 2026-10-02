import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { sentMails } from "@/server/email/mailer";
import { listReservations, lookupCaller, simpleReservation, reservationSettings, reservationSummary, setReservationStatus, tableConflict, updateReservationSettings, upsertReservation } from "@/server/services/reservations";
import { getFloorStatus } from "@/server/services/floor";
import { DEFAULT_RESERVATION_SETTINGS, normalizeReservationSettings, phoneKey, serviceOfTime, serviceSlots } from "@/lib/reservations";
import { addDays, localDay, zonedInputToDate } from "@/lib/dates";

let T: Awaited<ReturnType<typeof makeTenant>>;
const TZ = "Pacific/Tahiti";
const tomorrow = () => addDays(localDay(new Date(), TZ), 1);
const at = (day: string, hhmm: string) => zonedInputToDate(`${day}T${hhmm}`, TZ).toISOString();

beforeAll(async () => {
  process.env.EMAIL_TRANSPORT = "memory";
  await resetDb();
  T = await makeTenant("resa", { options: [] }); // programme de base : sans l'option Digital
});

describe("réservations au téléphone (programme de base)", () => {
  it("créneaux et réglages : valeurs par défaut, réglages invalides ignorés", async () => {
    expect(serviceSlots({ from: "11:30", to: "12:30" }, 15)).toEqual(["11:30", "11:45", "12:00", "12:15", "12:30"]);
    expect(serviceOfTime("12:00")).toBe("lunch");
    expect(serviceOfTime("19:30")).toBe("dinner");
    expect(phoneKey("+689 87 00 00 01")).toBe(phoneKey("87.00.00.01"));
    expect(normalizeReservationSettings({ interval: 7, duration: 5000, capacity: -3, services: [{ key: "lunch", enabled: false, from: "25:00", to: "14:00" }] })).toEqual({
      ...DEFAULT_RESERVATION_SETTINGS, services: [{ ...DEFAULT_RESERVATION_SETTINGS.services[0], enabled: false }, DEFAULT_RESERVATION_SETTINGS.services[1]],
    });
    const s = await updateReservationSettings(T.managerActor, { interval: 30, duration: 120, capacity: 40 });
    expect(s).toMatchObject({ interval: 30, duration: 120, capacity: 40 });
    expect((await reservationSettings(T.est.id)).duration).toBe(120);
    await updateReservationSettings(T.managerActor, { interval: 15, duration: 90, capacity: null });
  });

  it("le serveur prend une réservation : confirmée, client créé, allergies retenues, prise par qui", async () => {
    const r = await upsertReservation(T.actor, { name: "Moana Teriitahi", phone: "87 11 22 33", startsAt: at(tomorrow(), "19:30"), partySize: 4, tableId: T.t1.id, allergies: "Crustacés", tags: ["birthday", "pas-un-repère"] });
    expect(r).toMatchObject({ status: "CONFIRMED", source: "PHONE", durationMinutes: 90, tags: ["birthday"] });
    expect(r.createdByName).toBeTruthy();
    const c = await prisma.customer.findUniqueOrThrow({ where: { id: r.customerId! } });
    expect(c.allergies).toBe("Crustacés");
  });

  it("sans l'option Digital : réservation simple (ni table d'avance, ni repères, ni e-mail)", () => {
    const input = { name: "Teva", startsAt: at(tomorrow(), "12:00"), partySize: 2, tableId: T.t1.id, tags: ["birthday"], notify: true, durationMinutes: 120, allergies: "Gluten" };
    expect(simpleReservation({ options: [] }, input)).toEqual({ name: "Teva", startsAt: input.startsAt, partySize: 2, allergies: "Gluten" });
    expect(simpleReservation({ options: ["digital"] }, input)).toEqual(input);
  });

  it("une table n'est jamais donnée deux fois sur le même créneau", async () => {
    const day = tomorrow();
    await expect(upsertReservation(T.actor, { name: "Teva", phone: "87000002", startsAt: at(day, "20:00"), partySize: 2, tableId: T.t1.id })).rejects.toMatchObject({ status: 409, code: "TABLE_TAKEN" });
    // Après le temps à table (19:30 + 1 h 30), la table est libre
    const later = await upsertReservation(T.actor, { name: "Teva", phone: "87000002", startsAt: at(day, "21:00"), partySize: 2, tableId: T.t1.id });
    expect(later.tableId).toBe(T.t1.id);
    expect(await tableConflict(T.est.id, T.t1.id, new Date(at(day, "18:30")), 60)).toBeNull();
    expect((await tableConflict(T.est.id, T.t1.id, new Date(at(day, "18:30")), 90))?.name).toBe("Moana Teriitahi");
    // Une réservation annulée libère sa table
    await setReservationStatus(T.actor, later.id, "CANCELLED");
    expect(await tableConflict(T.est.id, T.t1.id, new Date(at(day, "21:00")), 90)).toBeNull();
    // Modifier une réservation sans changer de table ne crée pas de conflit avec elle-même
    const list = await listReservations(T.est.id, day, TZ);
    const moana = list.find((r) => r.name === "Moana Teriitahi")!;
    const moved = await upsertReservation(T.actor, { id: moana.id, name: moana.name, phone: moana.phone, startsAt: at(day, "19:45"), partySize: 5, tableId: T.t1.id });
    expect(moved.partySize).toBe(5);
  });

  it("le client qui rappelle est reconnu à son numéro, avec ses absences et ses réservations à venir", async () => {
    const r = await upsertReservation(T.actor, { name: "Hina", phone: "+689 87 99 88 77", startsAt: at(addDays(localDay(new Date(), TZ), -3), "12:00"), partySize: 2 });
    await setReservationStatus(T.actor, r.id, "NO_SHOW");
    const caller = await lookupCaller(T.actor, "87998877");
    expect(caller).toMatchObject({ name: "Hina", noShows: 1 });
    expect((await lookupCaller(T.actor, "87 11 22 33"))!.upcoming).toHaveLength(1);
    expect(await lookupCaller(T.actor, "12")).toBeNull();
    expect(await lookupCaller(T.actor, "80000000")).toBeNull();
  });

  it("semaine : réservations et couverts par jour, sans les annulations", async () => {
    const days = await reservationSummary(T.est.id, tomorrow(), 2, TZ);
    expect(days[0]).toMatchObject({ day: tomorrow(), count: 1, covers: 5, pending: 0 });
    expect(days[1].count).toBe(0);
  });

  it("confirmation par e-mail au client quand il le souhaite", async () => {
    const before = sentMails.length;
    await upsertReservation(T.actor, { name: "Sophie", phone: "87123123", email: "sophie@mail.pf", startsAt: at(tomorrow(), "12:15"), partySize: 3, notify: true });
    expect(sentMails.length).toBe(before + 1);
    expect(sentMails.at(-1)!.subject).toContain("Réservation confirmée");
    expect(sentMails.at(-1)!.html).toContain("3 personnes");
    await upsertReservation(T.actor, { name: "Paul", phone: "87123124", email: "paul@mail.pf", startsAt: at(tomorrow(), "12:30"), partySize: 2 });
    expect(sentMails.length).toBe(before + 1); // sans « notify », rien n'est envoyé
  });

  it("plan de salle : la prochaine réservation du jour s'affiche sur sa table, « réservée » dans l'heure qui précède", async () => {
    const soon = new Date(Date.now() + 30 * 60_000);
    if (localDay(soon, TZ) !== localDay(new Date(), TZ)) return; // juste avant minuit : rien à afficher pour aujourd'hui
    const r = await upsertReservation(T.actor, { name: "Famille Wong", phone: "87555444", startsAt: soon.toISOString(), partySize: 6, tableId: T.t2.id });
    const t2 = (await getFloorStatus(T.est.id)).rooms.flatMap((x) => x.tables).find((t) => t.id === T.t2.id)!;
    expect(t2.reservation).toMatchObject({ id: r.id, name: "Famille Wong", partySize: 6 });
    expect(t2.status).toBe("RESERVED");
    await setReservationStatus(T.actor, r.id, "CANCELLED");
    const after = (await getFloorStatus(T.est.id)).rooms.flatMap((x) => x.tables).find((t) => t.id === T.t2.id)!;
    expect(after.reservation).toBeNull();
    expect(after.status).toBe("FREE");
  });
});
