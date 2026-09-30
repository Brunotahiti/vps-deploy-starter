/** Offre commerciale ManaResto (Polynésie française). */
export const OFFER = {
  trialDays: 15,          // essai gratuit, sans carte bancaire
  monthly: 12_000,        // F CFP par mois
  commitmentMonths: 12,   // engagement
  commission: 0,          // % sur les commandes en ligne et les ventes
  contactEmail: "contact@manaresto.com",
  siteUrl: "https://www.manaresto.com",
} as const;

export type SubscriptionInfo = { plan: "TRIAL" | "ACTIVE" | "SUSPENDED"; trialEndsAt: string | null; daysLeft: number | null; expired: boolean; label: string };

/** Décrit l'état de l'abonnement pour l'interface (bandeau, page Abonnement). */
export function subscriptionInfo(org: { plan: "TRIAL" | "ACTIVE" | "SUSPENDED"; trialEndsAt: Date | string | null }, now = new Date()): SubscriptionInfo {
  const ends = org.trialEndsAt ? new Date(org.trialEndsAt) : null;
  if (org.plan === "ACTIVE") return { plan: "ACTIVE", trialEndsAt: null, daysLeft: null, expired: false, label: "Abonnement actif" };
  if (org.plan === "SUSPENDED") return { plan: "SUSPENDED", trialEndsAt: null, daysLeft: null, expired: true, label: "Abonnement suspendu" };
  const daysLeft = ends ? Math.max(0, Math.ceil((ends.getTime() - now.getTime()) / 86_400_000)) : OFFER.trialDays;
  const expired = ends ? ends.getTime() < now.getTime() : false;
  return { plan: "TRIAL", trialEndsAt: ends ? ends.toISOString() : null, daysLeft, expired, label: expired ? "Essai gratuit terminé" : `Essai gratuit : ${daysLeft} jour${daysLeft > 1 ? "s" : ""} restant${daysLeft > 1 ? "s" : ""}` };
}
