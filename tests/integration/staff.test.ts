import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { clock, clockStatus, computeHours, createEmployeesFromUsers, deleteShift, listEmployees, listEntries, presentNow, staffSummary, upsertEmployee, upsertEntry, upsertShift } from "@/server/services/staff";
import { getPeriodReport } from "@/server/services/reports";
import { buildExport, toCsv, toPdf, toXlsx } from "@/server/reports/export";
import { addItem, createOrder, sendCourse } from "@/server/services/orders";
import { addPayments } from "@/server/services/payments";
import { addDays, localDay, startOfLocalDay } from "@/lib/dates";

let T: Awaited<ReturnType<typeof makeTenant>>;
const TZ = "Pacific/Tahiti";

beforeAll(async () => {
  await resetDb();
  T = await makeTenant("staff");
});

describe("Phase 5 — personnel, pointage, coût et rapports", () => {
  it("crée les fiches depuis les utilisateurs et un extra avec PIN", async () => {
    const r = await createEmployeesFromUsers(T.managerActor);
    expect(r.created).toBe(3); // owner, manager, server
    const extra = await upsertEmployee(T.managerActor, { firstName: "Tehani", lastName: "Extra", jobTitle: "Plonge", hourlyCost: 1400, pin: "7777" });
    expect(extra.hasPin).toBe(true);
    expect(extra).not.toHaveProperty("pinHash");
    const list = await listEmployees(T.est.id);
    expect(list.length).toBe(4);
    expect(list.find((e) => e.id === extra.id)!.hasPin).toBe(true);
    await expect(upsertEmployee(T.managerActor, { userId: T.server.id, firstName: "Doublon", lastName: "X" })).rejects.toMatchObject({ code: "USER_LINKED" });
  });

  it("pointage : PIN employé ou PIN du compte, séquence contrôlée, état et présents", async () => {
    // Extra : PIN employé
    let r = await clock(T.est.id, "7777", "CLOCK_IN");
    expect(r.state).toBe("IN");
    expect(r.allowed).toEqual(["BREAK_START", "CLOCK_OUT"]);
    await expect(clock(T.est.id, "7777", "CLOCK_IN")).rejects.toMatchObject({ code: "BAD_CLOCK_SEQUENCE" });
    await expect(clock(T.est.id, "7777", "BREAK_END")).rejects.toMatchObject({ code: "BAD_CLOCK_SEQUENCE" });
    r = await clock(T.est.id, "7777", "BREAK_START");
    expect(r.state).toBe("BREAK");
    r = await clock(T.est.id, "7777", "BREAK_END");
    expect(r.state).toBe("IN");
    // Serveur : PIN du compte utilisateur (1001)
    const s = await clock(T.est.id, "1001", "CLOCK_IN");
    expect(s.employee.firstName).toBe("Server");
    const present = await presentNow(T.est.id);
    expect(present.map((p) => p.firstName).sort()).toEqual(["Server", "Tehani"]);
    await expect(clockStatus(T.est.id, "0000")).rejects.toMatchObject({ code: "BAD_PIN" });
    r = await clock(T.est.id, "7777", "CLOCK_OUT");
    expect(r.state).toBe("OUT");
    expect(r.allowed).toEqual(["CLOCK_IN"]);
    const status = await clockStatus(T.est.id, "7777");
    expect(status.entries.map((e) => e.kind)).toEqual(["CLOCK_IN", "BREAK_START", "BREAK_END", "CLOCK_OUT"]);
  });

  it("calcule heures travaillées, pauses et sessions", () => {
    const base = new Date("2026-09-01T10:00:00Z").getTime();
    const at = (min: number) => new Date(base + min * 60000);
    const h = computeHours([{ kind: "CLOCK_IN", at: at(0) }, { kind: "BREAK_START", at: at(120) }, { kind: "BREAK_END", at: at(150) }, { kind: "CLOCK_OUT", at: at(270) }, { kind: "CLOCK_IN", at: at(400) }, { kind: "CLOCK_OUT", at: at(460) }], at(500));
    expect(h.workedMs / 60000).toBe(120 + 120 + 60);
    expect(h.breakMs / 60000).toBe(30);
    expect(h.sessions).toBe(2);
    expect(h.open).toBe(false);
    const open = computeHours([{ kind: "CLOCK_IN", at: new Date(Date.now() - 3600_000) }], new Date(Date.now() + 3600_000));
    expect(open.open).toBe(true);
    expect(Math.round(open.workedMs / 60000)).toBe(60);
  });

  it("planning, corrections de pointage et synthèse heures / coût", async () => {
    // Journée de référence fixe (hier, heure de Tahiti) : le test ne dépend plus de l'heure à laquelle il tourne
    const day = addDays(localDay(new Date(), TZ), -1);
    const base = startOfLocalDay(day, TZ).getTime() + 8 * 3600_000; // 8 h du matin, heure locale
    const extra = (await listEmployees(T.est.id)).find((e) => e.firstName === "Tehani")!;
    const shift = await upsertShift(T.managerActor, { employeeId: extra.id, startsAt: new Date(base).toISOString(), endsAt: new Date(base + 4 * 3600_000).toISOString(), notes: "Midi" });
    await expect(upsertShift(T.managerActor, { employeeId: extra.id, startsAt: new Date().toISOString(), endsAt: new Date(Date.now() - 1000).toISOString() })).rejects.toMatchObject({ code: "BAD_RANGE" });
    // Correction manager : l'extra a travaillé 4 h (pointages recalés)
    const entries = await listEntries(T.est.id, new Date(Date.now() - 86400_000), new Date(Date.now() + 86400_000), extra.id);
    const [cin, bs, be, cout] = entries;
    await upsertEntry(T.managerActor, { id: cin.id, at: new Date(base).toISOString(), reason: "Recalage" });
    await upsertEntry(T.managerActor, { id: bs.id, at: new Date(base + 2 * 3600_000).toISOString(), reason: "Recalage" });
    await upsertEntry(T.managerActor, { id: be.id, at: new Date(base + 2.5 * 3600_000).toISOString(), reason: "Recalage" });
    await upsertEntry(T.managerActor, { id: cout.id, at: new Date(base + 4.5 * 3600_000).toISOString(), reason: "Recalage" });
    const s = await staffSummary(T.est.id, day, day, TZ);
    const row = s.rows.find((r) => r.id === extra.id)!;
    expect(row.hours).toBe(4);
    expect(row.breakHours).toBe(0.5);
    expect(row.plannedHours).toBe(4);
    expect(row.cost).toBe(4 * 1400);
    expect(s.totalCost).toBeGreaterThanOrEqual(5600);
    const audits = await prisma.auditLog.count({ where: { action: "time_entry.correct" } });
    expect(audits).toBe(4);
    await deleteShift(T.managerActor, shift.id);
  });

  it("rapport de période avec comparaison et exports CSV / Excel / PDF", async () => {
    const today = localDay(new Date(), TZ);
    const o = await createOrder(T.actor, { type: "COUNTER" });
    await addItem(T.actor, o.id, { productId: T.eau.id, quantity: 3 });
    await sendCourse(T.actor, o.id, { all: true });
    await addPayments(T.actor, o.id, [{ method: "CARD", amount: 900 }]);
    const r = await getPeriodReport(T.est.id, today, today, TZ);
    expect(r.revenue).toBe(900);
    expect(r.tickets).toBe(1);
    expect(r.byProduct[0]).toMatchObject({ name: "Eau", quantity: 3, revenue: 900 });
    expect(r.byMethod[0]).toMatchObject({ method: "CARD", amount: 900 });
    expect(r.byType[0].type).toBe("COUNTER");
    expect(r.previous).not.toBeNull();
    expect(r.previous!.revenue).toBe(0);
    expect(r.byDay.length).toBe(1);
    for (const type of ["period", "products", "orders", "staff"] as const) {
      const { title, sheets } = await buildExport(T.est.id, type, today, today, TZ);
      expect(title).toContain(today);
      const csv = toCsv(sheets);
      expect(csv.startsWith("﻿")).toBe(true);
      const xlsx = await toXlsx(sheets, title);
      expect(xlsx.subarray(0, 2).toString()).toBe("PK");
      const pdf = await toPdf(sheets, title, "Resto", "XPF");
      expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    }
    const products = await buildExport(T.est.id, "products", today, today, TZ);
    expect(toCsv(products.sheets)).toContain("Eau;");
    const staff = await buildExport(T.est.id, "staff", today, today, TZ);
    expect(toCsv(staff.sheets)).toContain("Tehani Extra");
  });
});

describe("heures : oublis de pointage et services à cheval sur minuit", () => {
  const t = (h: number) => new Date(Date.UTC(2026, 8, 1, 0, 0) + h * 3600_000);
  it("une arrivée sans sortie n'est pas payée jusqu'à l'arrivée suivante", () => {
    const h = computeHours([{ kind: "CLOCK_IN", at: t(10) }, { kind: "CLOCK_IN", at: t(34) }, { kind: "CLOCK_OUT", at: t(42) }], t(48));
    expect(h.workedMs / 3600_000).toBe(8);
    expect(h.anomalies).toBe(1);
  });
  it("service commencé la veille : les heures après minuit comptent", () => {
    const h = computeHours([{ kind: "CLOCK_OUT", at: t(1) }], t(24), { initial: { kind: "CLOCK_IN" }, periodStart: t(0) });
    expect(h.workedMs / 3600_000).toBe(1);
  });
});
