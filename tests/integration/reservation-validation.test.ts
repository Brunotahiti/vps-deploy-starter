import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { sentMails } from "@/server/email/mailer";
import { publicReservationSchema } from "@/server/schemas";
import { createPublicReservation, pendingReservations, setReservationStatus, upsertReservation } from "@/server/services/reservations";

let T: Awaited<ReturnType<typeof makeTenant>>;
const at = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

beforeAll(async () => {
  process.env.EMAIL_TRANSPORT = "memory";
  await resetDb();
  T = await makeTenant("resa-validation");
});

describe("réservation en ligne : e-mail obligatoire, validation par l'équipe, réponse par e-mail", () => {
  it("e-mail obligatoire et valide (formulaire et serveur)", async () => {
    const base = { name: "Hina", phone: "87 12 34 56", startsAt: at(30), partySize: 2 };
    expect(publicReservationSchema.safeParse(base).success).toBe(false);
    expect(publicReservationSchema.safeParse({ ...base, email: "pas-un-mail" }).success).toBe(false);
    expect(publicReservationSchema.safeParse({ ...base, email: "hina@exemple.pf" }).success).toBe(true);
    await expect(createPublicReservation(T.est.id, T.org.id, { ...base, email: "" })).rejects.toMatchObject({ code: "EMAIL_REQUIRED" });
  });

  it("demande reçue : accusé de réception au client, demande en tête de la liste à valider", async () => {
    sentMails.length = 0;
    const r = await createPublicReservation(T.est.id, T.org.id, { name: "Moana", phone: "87 00 11 22", email: "moana@exemple.pf", startsAt: at(26), partySize: 4, allergies: "Crustacés" });
    expect(r.status).toBe("PENDING");
    expect(sentMails).toHaveLength(1);
    expect(sentMails[0]).toMatchObject({ to: "moana@exemple.pf", subject: expect.stringContaining("Demande de réservation reçue") });
    expect(sentMails[0].html).toContain("vous envoie sa réponse par e-mail");
    const pending = await pendingReservations(T.est.id);
    expect(pending.map((p) => p.id)).toEqual([r.id]);
    expect(pending[0]).toMatchObject({ name: "Moana", partySize: 4, allergies: "Crustacés", email: "moana@exemple.pf" });
  });

  it("confirmée par l'équipe : e-mail de confirmation, la demande quitte la liste", async () => {
    const [r] = await pendingReservations(T.est.id);
    sentMails.length = 0;
    await setReservationStatus(T.actor, r.id, "CONFIRMED");
    expect(sentMails).toHaveLength(1);
    expect(sentMails[0]).toMatchObject({ to: "moana@exemple.pf", subject: expect.stringContaining("Réservation confirmée") });
    expect(await pendingReservations(T.est.id)).toHaveLength(0);
  });

  it("refusée avec un message : e-mail « non disponible » avec le message du restaurant", async () => {
    const r = await createPublicReservation(T.est.id, T.org.id, { name: "Teva", phone: "87 99 88 77", email: "teva@exemple.pf", startsAt: at(50), partySize: 12 });
    sentMails.length = 0;
    await setReservationStatus(T.actor, r.id, "CANCELLED", null, false, "Complet ce soir-là, nous pouvons vous proposer 21 h.");
    expect(sentMails).toHaveLength(1);
    expect(sentMails[0].subject).toContain("Réservation non disponible");
    expect(sentMails[0].html).toContain("Complet ce soir-là, nous pouvons vous proposer 21 h.");
    expect(sentMails[0].text).toContain("Message du restaurant");
  });

  it("réservation prise au téléphone : pas d'e-mail automatique (sauf demande explicite)", async () => {
    const phone = await upsertReservation(T.managerActor, { name: "Marc", phone: "89 12 34 56", email: "marc@exemple.pf", startsAt: at(28), partySize: 2 });
    sentMails.length = 0;
    await setReservationStatus(T.actor, phone.id, "CANCELLED");
    expect(sentMails).toHaveLength(0);
  });
});
