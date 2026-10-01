import { prisma } from "@/server/db";
import { ApiError } from "@/server/errors";
import { isEmailConfigured, platformMail, sendMail, signupAlertMail, type OutgoingMail } from "@/server/email/mailer";
import { OFFER } from "@/lib/plan";
import { formatDate } from "@/lib/dates";
import { DEMO_EST_SLUG, DEMO_ORG_SLUG, parseAdminEmails, type PlatformEmailKind } from "@/lib/platform";

/*
 * E-mails de la plateforme vers les restaurateurs : bienvenue à l'inscription, rappel avant la fin de l'essai,
 * essai expiré, et messages libres envoyés depuis la console. Chaque envoi est journalisé (PlatformEmail).
 * Expéditeur : SMTP_FROM (ex. « ManaResto <contact@manaresto.com> » via le relais SMTP Brevo) ; réponses vers OFFER.contactEmail.
 */

const DAY = 86_400_000;
export const REMINDER_DAYS_BEFORE = 3;   // rappel quand il reste 3 jours d'essai ou moins
export const EXPIRED_WINDOW_DAYS = 7;    // « essai expiré » envoyé seulement pour les essais finis depuis moins de 7 jours

const appUrl = () => process.env.PUBLIC_URL?.replace(/\/$/, "") || "https://app.manaresto.com";
const TZ = "Pacific/Tahiti";

type Org = { id: string; name: string; trialEndsAt: Date | null };
type Owner = { id: string; email: string; firstName: string };

async function loadTarget(organizationId: string) {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true, name: true, trialEndsAt: true } });
  if (!org) throw new ApiError(404, "NOT_FOUND", "Restaurant introuvable");
  const owner = await prisma.user.findFirst({ where: { organizationId, isOwner: true }, orderBy: { createdAt: "asc" }, select: { id: true, email: true, firstName: true } });
  if (!owner) throw new ApiError(404, "NO_OWNER", "Ce compte n'a pas de propriétaire");
  return { org, owner };
}

const base = (org: Org, owner: Owner) => ({ to: owner.email, kicker: `ManaResto · ${org.name}`, replyTo: OFFER.contactEmail, footer: `Vous recevez cet e-mail car vous avez un compte ManaResto pour ${org.name}.` });
const price = `${OFFER.monthly.toLocaleString("fr-FR").replace(/ /g, " ")} F CFP par mois, engagement ${OFFER.commitmentMonths} mois, ${OFFER.commission} % de commission sur vos ventes et vos commandes en ligne`;

export function welcomeMail(org: Org, owner: Owner): OutgoingMail {
  return platformMail({
    ...base(org, owner),
    subject: `Bienvenue sur ManaResto, ${owner.firstName} !`,
    title: `Ia ora na ${owner.firstName}, bienvenue !`,
    paragraphs: [
      `Votre compte ManaResto pour « ${org.name} » est prêt. Vous profitez de ${OFFER.trialDays} jours d'essai gratuit, sans carte bancaire.`,
      "Pour bien démarrer : ajoutez vos plats et leurs photos, dessinez votre plan de salle, puis ouvrez la caisse sur votre tablette, votre téléphone ou votre ordinateur. L'assistant de démarrage vous guide pas à pas.",
      "Envie de voir d'abord ManaResto en plein service ? Essayez gratuitement la démo : un restaurant fictif, Le Mana Beach, avec sa carte en photos, ses tables occupées, ses tickets en cuisine, ses réservations et deux mois de chiffres. Vous pouvez tout essayer, rien n'est réel. Découvrez aussi sa page publique : c'est le site que ManaResto crée pour votre restaurant, avec votre carte, vos horaires, la réservation et la commande en ligne.",
      "Une question ? Répondez simplement à cet e-mail : nous vous aidons à tout mettre en place.",
    ],
    cta: { label: "Ouvrir ManaResto", url: `${appUrl()}/admin` },
    secondary: [
      { label: "Essayer la démo gratuitement", url: `${appUrl()}/login?demo=1`, note: "La démo s'ouvre dans le compte d'exemple : reconnectez-vous ensuite à votre compte." },
      { label: "Voir un exemple de page restaurant", url: `${appUrl()}/site/${DEMO_ORG_SLUG}/${DEMO_EST_SLUG}` },
    ],
  });
}

export function trialReminderMail(org: Org, owner: Owner, now = new Date()): OutgoingMail {
  const ends = org.trialEndsAt ?? now;
  const days = Math.max(1, Math.ceil((ends.getTime() - now.getTime()) / DAY));
  return platformMail({
    ...base(org, owner),
    subject: `Votre essai ManaResto se termine dans ${days} jour${days > 1 ? "s" : ""}`,
    title: `Plus que ${days} jour${days > 1 ? "s" : ""} d'essai`,
    paragraphs: [
      `Bonjour ${owner.firstName}, votre essai gratuit de ManaResto pour « ${org.name} » se termine le ${formatDate(ends, TZ)}.`,
      `Pour continuer sans interruption, l'abonnement est de ${price}.`,
      "Répondez à cet e-mail pour activer votre abonnement ou poser vos questions : nous vous répondons rapidement.",
    ],
    cta: { label: "Ouvrir ManaResto", url: `${appUrl()}/admin` },
  });
}

export function trialExpiredMail(org: Org, owner: Owner, now = new Date()): OutgoingMail {
  const ends = org.trialEndsAt ?? now;
  return platformMail({
    ...base(org, owner),
    subject: "Votre essai ManaResto est terminé",
    title: "Votre essai gratuit est terminé",
    paragraphs: [
      `Bonjour ${owner.firstName}, la période d'essai de ManaResto pour « ${org.name} » s'est terminée le ${formatDate(ends, TZ)}. Vos données (carte, plan de salle, commandes) sont conservées.`,
      `Pour continuer à utiliser ManaResto : ${price}.`,
      "Répondez simplement à cet e-mail et nous activons votre abonnement.",
    ],
    cta: { label: "Ouvrir ManaResto", url: `${appUrl()}/admin` },
  });
}

export function manualMail(org: Org, owner: Owner, subject: string, message: string): OutgoingMail {
  return platformMail({ ...base(org, owner), subject, title: subject, paragraphs: message.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean) });
}

/** Envoie et journalise un e-mail plateforme. Retourne le statut (SENT ou FAILED). */
async function deliver(organizationId: string, kind: PlatformEmailKind, mail: OutgoingMail, sentById?: string | null) {
  let status = "SENT";
  let error: string | null = null;
  try { await sendMail(mail); } catch (e) { status = "FAILED"; error = explainSmtpError(e instanceof Error ? e.message : String(e)); }
  await prisma.platformEmail.create({ data: { organizationId, kind, to: mail.to, subject: mail.subject, status, error, sentById: sentById ?? null } });
  return { status, error };
}

/** Bienvenue à l'inscription (ignoré si l'envoi d'e-mails n'est pas configuré). */
export async function sendWelcomeEmail(organizationId: string) {
  if (!isEmailConfigured()) return null;
  const { org, owner } = await loadTarget(organizationId);
  return deliver(org.id, "WELCOME", welcomeMail(org, owner));
}

/** Message libre depuis la console plateforme. */
export async function sendManualEmail(organizationId: string, subject: string, message: string, sentById: string) {
  if (!isEmailConfigured()) throw new ApiError(400, "EMAIL_NOT_CONFIGURED", "L'envoi d'e-mails n'est pas configuré (variables SMTP_* du serveur)");
  const { org, owner } = await loadTarget(organizationId);
  const r = await deliver(org.id, "MANUAL", manualMail(org, owner, subject, message), sentById);
  if (r.status !== "SENT") throw new ApiError(502, "EMAIL_FAILED", `Échec de l'envoi : ${r.error}`);
  return { to: owner.email };
}

/**
 * Relances automatiques, idempotentes : rappel à J-3 de la fin d'essai puis « essai expiré ».
 * Chaque type n'est envoyé qu'une fois par restaurant. Le compte de démonstration et les comptes bloqués sont ignorés.
 */
export async function runLifecycleEmails(now = new Date()) {
  if (!isEmailConfigured()) return { reminders: 0, expired: 0 };
  const orgs = await prisma.organization.findMany({
    where: { plan: "TRIAL", blockedAt: null, slug: { not: DEMO_ORG_SLUG }, trialEndsAt: { gte: new Date(now.getTime() - EXPIRED_WINDOW_DAYS * DAY), lte: new Date(now.getTime() + REMINDER_DAYS_BEFORE * DAY) } },
    select: { id: true, trialEndsAt: true, platformEmails: { where: { kind: { in: ["TRIAL_REMINDER", "TRIAL_EXPIRED"] } }, select: { kind: true, status: true } } },
  });
  let reminders = 0;
  let expired = 0;
  for (const o of orgs) {
    // Déjà ENVOYÉ, ou 3 échecs : on ne relance plus. Un échec isolé (panne SMTP) est retenté à l'heure suivante.
    const sent = new Set(o.platformEmails.filter((e) => e.status === "SENT").map((e) => e.kind));
    for (const k of ["TRIAL_REMINDER", "TRIAL_EXPIRED"]) if (o.platformEmails.filter((e) => e.kind === k && e.status !== "SENT").length >= 3) sent.add(k);
    const ended = o.trialEndsAt!.getTime() <= now.getTime();
    const kind: PlatformEmailKind | null = ended ? (sent.has("TRIAL_EXPIRED") ? null : "TRIAL_EXPIRED") : sent.has("TRIAL_REMINDER") ? null : "TRIAL_REMINDER";
    if (!kind) continue;
    try {
      const { org, owner } = await loadTarget(o.id);
      const r = await deliver(o.id, kind, kind === "TRIAL_EXPIRED" ? trialExpiredMail(org, owner, now) : trialReminderMail(org, owner, now));
      if (r.status === "SENT") { if (kind === "TRIAL_EXPIRED") expired++; else reminders++; }
    } catch { /* compte sans propriétaire : ignoré */ }
  }
  return { reminders, expired };
}

const g = globalThis as unknown as { __mrLifecycleTimer?: ReturnType<typeof setInterval> };

/** Planificateur interne : relances toutes les heures (désactivable avec LIFECYCLE_EMAILS=off). */
export function startLifecycleScheduler() {
  if (g.__mrLifecycleTimer || process.env.LIFECYCLE_EMAILS === "off") return;
  const tick = () => { runLifecycleEmails().catch((e) => console.error("[relances] échec", e)); };
  setTimeout(tick, 2 * 60_000);
  g.__mrLifecycleTimer = setInterval(tick, 60 * 60_000);
  g.__mrLifecycleTimer.unref?.();
}

/** Destinataires des alertes internes (nouvelle inscription, demande de démo) : PLATFORM_NOTIFY_EMAILS, sinon l'adresse de contact. */
export function teamRecipients(): string {
  const list = parseAdminEmails(process.env.PLATFORM_NOTIFY_EMAILS);
  return (list.length ? list : [OFFER.contactEmail]).join(", ");
}
export const consoleUrl = () => `${appUrl()}/platform`;

/** Alerte à l'équipe ManaResto : un restaurant vient de s'inscrire. */
export async function sendSignupAlert(organizationId: string) {
  if (!isEmailConfigured()) return null;
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true, slug: true, trialEndsAt: true, establishments: { orderBy: { createdAt: "asc" }, take: 1, select: { name: true } } } });
  if (!org || org.slug === DEMO_ORG_SLUG) return null;
  const owner = await prisma.user.findFirst({ where: { organizationId, isOwner: true }, orderBy: { createdAt: "asc" }, select: { firstName: true, lastName: true, email: true } });
  if (!owner) return null;
  const total = await prisma.organization.count({ where: { slug: { not: DEMO_ORG_SLUG } } });
  await sendMail(signupAlertMail({
    to: teamRecipients(),
    organizationName: org.name,
    establishmentName: org.establishments[0]?.name ?? org.name,
    ownerName: `${owner.firstName} ${owner.lastName}`.trim(),
    email: owner.email,
    trialEndsLabel: org.trialEndsAt ? formatDate(org.trialEndsAt, TZ) : "—",
    consoleUrl: consoleUrl(),
    total,
  }));
  return { sent: true };
}

/** Traduit une erreur SMTP (Brevo) en explication actionnable. */
export function explainSmtpError(raw: string): string {
  const m = raw || "";
  if (/not yet activated|account is not activated|not activated/i.test(m)) return "Le compte SMTP Brevo n'est pas encore activé : demandez son activation au support Brevo (Aide → Contacter le support).";
  if (/sender|expéditeur|unauthori[sz]ed|550|553|554/i.test(m)) return "Brevo refuse l'expéditeur : ajoutez et validez contact@manaresto.com dans Brevo → Expéditeurs, et vérifiez que le domaine manaresto.com est authentifié.";
  if (/535|invalid login|authentication failed|EAUTH/i.test(m)) return "Brevo refuse l'identifiant ou la clé SMTP. SMTP_USER doit être l'identifiant affiché dans Brevo (…@smtp-brevo.com) et SMTP_PASS une clé SMTP (xsmtpsib-…), pas une clé API (xkeysib-…).";
  if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND|ECONNRESET|timeout|greeting/i.test(m)) return "Le serveur n'arrive pas à joindre smtp-relay.brevo.com sur le port 587 (réseau ou pare-feu du VPS).";
  if (/EMAIL_NOT_CONFIGURED/.test(m)) return "L'envoi d'e-mails n'est pas configuré : ajoutez les variables SMTP_* dans le fichier .env du serveur.";
  return m.slice(0, 300) || "Erreur d'envoi inconnue";
}

/** Réglages d'envoi visibles dans la console (sans la clé). */
export function emailSettings() {
  return { configured: isEmailConfigured(), host: process.env.SMTP_HOST ?? null, user: process.env.SMTP_USER ?? null, from: process.env.SMTP_FROM || process.env.SMTP_USER || null, keyKind: process.env.SMTP_PASS?.startsWith("xkeysib-") ? "API" : process.env.SMTP_PASS ? "SMTP" : null, recipients: teamRecipients() };
}

/** E-mail de test vers les destinataires des alertes : confirme que Brevo accepte l'envoi, ou explique pourquoi pas. */
export async function sendTestEmail() {
  if (!isEmailConfigured()) throw new ApiError(400, "EMAIL_NOT_CONFIGURED", explainSmtpError("EMAIL_NOT_CONFIGURED"));
  const to = teamRecipients();
  try {
    await sendMail(platformMail({ to, subject: "Test d'envoi ManaResto", kicker: "ManaResto · console", title: "L'envoi d'e-mails fonctionne", paragraphs: ["Cet e-mail de test a été envoyé depuis la console ManaResto.", "Vous recevrez ici les alertes à chaque nouvelle inscription et à chaque demande de démonstration du site."], cta: { label: "Ouvrir la console", url: consoleUrl() }, replyTo: OFFER.contactEmail, footer: "E-mail de test envoyé depuis la console plateforme." }));
  } catch (e) {
    throw new ApiError(502, "EMAIL_FAILED", explainSmtpError(e instanceof Error ? e.message : String(e)));
  }
  return { to };
}
