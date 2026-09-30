import { describe, expect, it } from "vitest";
import { OFFER, subscriptionInfo } from "@/lib/plan";

describe("offre commerciale", () => {
  it("décrit l'essai gratuit, son échéance et l'abonnement", () => {
    expect(OFFER.trialDays).toBe(15);
    expect(OFFER.commitmentMonths).toBe(12);
    expect(OFFER.monthly).toBe(12_000);
    expect(OFFER.commission).toBe(0);
    const now = new Date("2026-10-01T10:00:00Z");
    const trial = subscriptionInfo({ plan: "TRIAL", trialEndsAt: new Date("2026-10-16T10:00:00Z") }, now);
    expect(trial.daysLeft).toBe(15);
    expect(trial.expired).toBe(false);
    expect(trial.label).toContain("15 jours");
    const lastDay = subscriptionInfo({ plan: "TRIAL", trialEndsAt: new Date("2026-10-01T18:00:00Z") }, now);
    expect(lastDay.daysLeft).toBe(1);
    expect(lastDay.label).toContain("1 jour restant");
    const over = subscriptionInfo({ plan: "TRIAL", trialEndsAt: new Date("2026-09-30T10:00:00Z") }, now);
    expect(over.expired).toBe(true);
    expect(over.daysLeft).toBe(0);
    expect(subscriptionInfo({ plan: "ACTIVE", trialEndsAt: null }, now)).toMatchObject({ expired: false, label: "Abonnement actif" });
    expect(subscriptionInfo({ plan: "SUSPENDED", trialEndsAt: null }, now).expired).toBe(true);
  });
});
