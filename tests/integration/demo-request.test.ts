import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { resetDb } from "../setup/db";
import { prisma } from "@/server/db";
import { POST } from "@/app/api/public/demo-request/route";
import { demoRequestMail } from "@/server/email/mailer";

/** Formulaire « Demander une démonstration » du site vitrine (www.manaresto.com → /api/demo → /api/public/demo-request) */
// Une adresse IP par envoi : la limite de 5 demandes par IP et par 10 minutes ne doit pas gêner ces tests
let n = 0;
const send = (body: Record<string, unknown>, ip = `10.0.0.${++n}`) =>
  POST(new NextRequest("http://localhost/api/public/demo-request", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ consent: true, startedAt: Date.now() - 10_000, ...body }) }), { params: Promise.resolve({}) });

beforeAll(async () => { await resetDb(); });
beforeEach(async () => { await prisma.demoRequest.deleteMany(); await prisma.$executeRawUnsafe("delete from rate_hits"); });

describe("Site vitrine — demande de démonstration", () => {
  it("nom, établissement et un seul moyen de contact suffisent (téléphone ou e-mail)", async () => {
    expect((await send({ contactName: "Hina", restaurantName: "Snack Vaiete", phone: "87 12 34 56" })).status).toBe(200);
    expect((await send({ contactName: "Teva", restaurantName: "Roulotte Mana", email: "Teva@Example.PF" })).status).toBe(200);
    const rows = await prisma.demoRequest.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows).toMatchObject([
      { contactName: "Hina", restaurantName: "Snack Vaiete", phone: "87 12 34 56", email: null, commune: null, kind: null, consent: true },
      { contactName: "Teva", restaurantName: "Roulotte Mana", phone: null, email: "teva@example.pf", commune: null, kind: null },
    ]);
  });

  it("commune, type et message facultatifs sont enregistrés quand ils sont remplis", async () => {
    await send({ contactName: "Moana", restaurantName: "Le Lagon", phone: "+689 87 00 00 00", email: "moana@example.pf", commune: "Punaauia", kind: "RESTAURANT", message: "Plutôt le matin" });
    expect(await prisma.demoRequest.findFirst()).toMatchObject({ commune: "Punaauia", kind: "RESTAURANT", message: "Plutôt le matin" });
  });

  it("refuse une demande sans aucun moyen de contact, sans nom ou sans consentement", async () => {
    expect((await send({ contactName: "Hina", restaurantName: "Snack Vaiete" })).status).toBe(400);
    expect((await send({ contactName: "Hina", restaurantName: "Snack Vaiete", phone: "", email: "" })).status).toBe(400);
    expect((await send({ restaurantName: "Snack Vaiete", phone: "87 12 34 56" })).status).toBe(400);
    expect((await send({ contactName: "Hina", phone: "87 12 34 56" })).status).toBe(400);
    expect((await send({ contactName: "Hina", restaurantName: "Snack Vaiete", phone: "87 12 34 56", consent: false })).status).toBe(400);
    expect((await send({ contactName: "Hina", restaurantName: "Snack Vaiete", email: "pas-un-email" })).status).toBe(400);
    expect((await send({ contactName: "Hina", restaurantName: "Snack Vaiete", phone: "12" })).status).toBe(400);
    expect(await prisma.demoRequest.count()).toBe(0);
  });

  it("anti-robot : pot de miel ou envoi trop rapide → réponse « reçue » mais rien d'enregistré", async () => {
    expect((await send({ contactName: "Bot", restaurantName: "Spam", phone: "87 12 34 56", website: "http://spam" })).status).toBe(200);
    expect((await send({ contactName: "Bot", restaurantName: "Spam", phone: "87 12 34 56", startedAt: Date.now() })).status).toBe(200);
    expect(await prisma.demoRequest.count()).toBe(0);
  });

  it("l'e-mail à l'équipe n'affiche que les champs remplis et ne répond qu'à une adresse existante", () => {
    const m = demoRequestMail({ to: "contact@manaresto.com", restaurantName: "Snack Vaiete", contactName: "Hina", phone: "87 12 34 56", email: null, commune: null, kind: null });
    expect(m.subject).toBe("Démo ManaResto — Snack Vaiete");
    expect(m.text).toContain("Téléphone : 87 12 34 56");
    expect(m.text).not.toMatch(/E-mail :|Commune :|Type :/);
    expect(m.html).toContain('href="tel:87123456"');
    expect(m.html).not.toContain("mailto:");
    expect(m.replyTo).toBeUndefined();
    const full = demoRequestMail({ to: "contact@manaresto.com", restaurantName: "Le Lagon", contactName: "Moana", phone: null, email: "moana@example.pf", commune: "Punaauia", kind: "RESTAURANT" });
    expect(full.subject).toBe("Démo ManaResto — Le Lagon (Punaauia)");
    expect(full.replyTo).toBe("moana@example.pf");
    expect(full.html).not.toContain("tel:");
  });
});
