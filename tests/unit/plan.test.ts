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

import { accountStatus, formatMinutes, parseAdminEmails, relativeDays } from "@/lib/platform";

describe("console plateforme : formats", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  it("statut du compte", () => {
    expect(accountStatus({ plan: "TRIAL", trialEndsAt: "2026-10-05T00:00:00Z", blockedAt: null }, now)).toBe("TRIAL");
    expect(accountStatus({ plan: "TRIAL", trialEndsAt: "2026-09-30T00:00:00Z", blockedAt: null }, now)).toBe("EXPIRED");
    expect(accountStatus({ plan: "ACTIVE", trialEndsAt: null, blockedAt: null }, now)).toBe("ACTIVE");
    expect(accountStatus({ plan: "ACTIVE", trialEndsAt: null, blockedAt: now }, now)).toBe("BLOCKED");
  });
  it("durées et dates relatives", () => {
    expect(formatMinutes(0)).toBe("0 min");
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(65)).toBe("1 h 05");
    expect(formatMinutes(120)).toBe("2 h");
    expect(relativeDays("2026-09-28T12:00:00Z", now)).toBe("il y a 3 j");
    expect(relativeDays("2026-10-06T12:00:00Z", now)).toBe("dans 5 j");
    expect(relativeDays("2026-10-01T10:00:00Z", now)).toBe("il y a 2 h");
    expect(relativeDays(null, now)).toBe("—");
  });
  it("liste des administrateurs", () => {
    expect(parseAdminEmails(" A@b.com, c@d.fr ;e@f.pf ")).toEqual(["a@b.com", "c@d.fr", "e@f.pf"]);
    expect(parseAdminEmails(undefined)).toEqual([]);
  });
});
