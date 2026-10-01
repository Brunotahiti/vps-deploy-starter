/** Console plateforme ManaResto : libellés et formats partagés (serveur et navigateur). */

export type AccountStatus = "TRIAL" | "EXPIRED" | "ACTIVE" | "SUSPENDED" | "BLOCKED";
export type PlatformEmailKind = "WELCOME" | "TRIAL_REMINDER" | "TRIAL_EXPIRED" | "MANUAL";

/** Entreprise de démonstration créée par le jeu de données : exclue des statistiques et des relances. */
export const DEMO_ORG_SLUG = "demo-mana-beach";
export const DEMO_EST_SLUG = "le-mana-beach";

export const STATUS_LABEL: Record<AccountStatus, string> = {
  TRIAL: "Essai",
  EXPIRED: "Essai expiré",
  ACTIVE: "Actif",
  SUSPENDED: "Suspendu",
  BLOCKED: "Bloqué",
};

export const EMAIL_KIND_LABEL: Record<PlatformEmailKind, string> = {
  WELCOME: "Bienvenue",
  TRIAL_REMINDER: "Rappel fin d'essai",
  TRIAL_EXPIRED: "Essai expiré",
  MANUAL: "Message",
};

/** Statut affiché d'un compte : le blocage prime, puis l'abonnement, puis l'échéance de l'essai. */
export function accountStatus(org: { plan: "TRIAL" | "ACTIVE" | "SUSPENDED"; trialEndsAt: Date | string | null; blockedAt: Date | string | null }, now = new Date()): AccountStatus {
  if (org.blockedAt) return "BLOCKED";
  if (org.plan === "ACTIVE") return "ACTIVE";
  if (org.plan === "SUSPENDED") return "SUSPENDED";
  if (org.trialEndsAt && new Date(org.trialEndsAt).getTime() < now.getTime()) return "EXPIRED";
  return "TRIAL";
}

/** « il y a 3 j », « dans 5 j », « aujourd'hui », « il y a 2 h », « à l'instant ». */
export function relativeDays(date: Date | string | null | undefined, now = new Date()): string {
  if (!date) return "—";
  const diff = new Date(date).getTime() - now.getTime();
  const abs = Math.abs(diff);
  const past = diff < 0;
  if (abs < 60_000) return "à l'instant";
  if (abs < 3_600_000) { const m = Math.round(abs / 60_000); return past ? `il y a ${m} min` : `dans ${m} min`; }
  if (abs < 86_400_000) { const h = Math.round(abs / 3_600_000); return past ? `il y a ${h} h` : `dans ${h} h`; }
  const d = Math.round(abs / 86_400_000);
  return past ? `il y a ${d} j` : `dans ${d} j`;
}

/** Durée d'utilisation lisible : « 0 min », « 45 min », « 1 h 05 », « 12 h ». */
export function formatMinutes(total: number): string {
  if (!total || total < 1) return "0 min";
  if (total < 60) return `${Math.round(total)} min`;
  const h = Math.floor(total / 60);
  const m = Math.round(total % 60);
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

/** Adresses des administrateurs de la plateforme (variable PLATFORM_ADMIN_EMAILS, séparées par des virgules). */
export function parseAdminEmails(raw: string | undefined): string[] {
  return (raw ?? "").split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
}
