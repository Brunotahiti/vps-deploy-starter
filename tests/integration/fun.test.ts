import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { hashPin } from "@/server/auth/password";
import { goalOf, greeting } from "@/components/admin/fun";
import { gettingStarted } from "@/server/services/getting-started";

let T: Awaited<ReturnType<typeof makeTenant>>;

beforeAll(async () => {
  await resetDb();
  T = await makeTenant("ludique");
});

describe("Tableau de bord ludique", () => {
  it("salutation selon l'heure du restaurant (Tahiti)", () => {
    expect(greeting("Teiva", "Pacific/Tahiti", new Date("2026-10-02T18:30:00Z")).title).toBe("Bonjour Teiva 👋"); // 8 h 30
    expect(greeting("Teiva", "Pacific/Tahiti", new Date("2026-10-02T18:30:00Z")).mood).toMatch(/journée qui commence/);
    expect(greeting("Teiva", "Pacific/Tahiti", new Date("2026-10-03T05:00:00Z")).title).toBe("Bonsoir Teiva 👋"); // 19 h
    expect(greeting(undefined, "Pacific/Tahiti", new Date("2026-10-02T22:00:00Z")).title).toBe("Bonjour 👋"); // midi
    expect(greeting("Teiva", "Pacific/Tahiti", new Date("2026-10-02T14:15:00Z"))).toEqual({ title: "Bonsoir Teiva 👋", mood: "Belle nuit 🌙" }); // 4 h 15
    expect(greeting("Teiva", "Pacific/Tahiti", new Date("2026-10-03T05:00:00Z")).mood).toBe("Bonne soirée de service 🌙");
  });

  it("objectif du jour : moyenne des mêmes jours de la semaine, sinon des jours passés ; record", () => {
    // Vendredi 2 octobre 2026 ; vendredis précédents : 25/09, 18/09, 11/09, 04/09
    const history = [
      { day: "2026-09-04", revenue: 100000 }, { day: "2026-09-11", revenue: 140000 }, { day: "2026-09-18", revenue: 120000 }, { day: "2026-09-25", revenue: 0 },
      { day: "2026-09-29", revenue: 60000 }, { day: "2026-09-30", revenue: 180000 },
    ];
    expect(goalOf("2026-10-02", history)).toEqual({ target: 120000, record: 180000, label: "moyenne des 3 derniers vendredis" });
    expect(goalOf("2026-10-01", history)).toMatchObject({ target: 120000, label: "moyenne des derniers jours" }); // pas de jeudi : tous les jours
    expect(goalOf("2026-10-02", [])).toBeNull();
  });

  it("« Bien démarrer » se coche d'après les vraies données", async () => {
    let s = await gettingStarted(T.est.id, T.owner.id);
    const done = Object.fromEntries(s.steps.map((x) => [x.key, x.done]));
    // Le restaurant de test a déjà une carte (4 produits), des tables, un manager et un serveur ; le propriétaire a un PIN
    expect(done).toMatchObject({ menu: true, floor: true, team: true, pin: true, cash: false, sale: false });
    expect(s.established).toBe(false);
    await prisma.user.update({ where: { id: T.owner.id }, data: { pinHash: null } });
    s = await gettingStarted(T.est.id, T.owner.id);
    expect(s.steps.find((x) => x.key === "pin")!.done).toBe(false);
    await prisma.user.update({ where: { id: T.owner.id }, data: { pinHash: await hashPin("9999") } });
    // Snack : pas d'étape « salle »
    await prisma.establishment.update({ where: { id: T.est.id }, data: { businessType: "snack" } });
    s = await gettingStarted(T.est.id, T.owner.id);
    expect(s.steps.some((x) => x.key === "floor")).toBe(false);
    expect(s.total).toBe(5);
  });
});
