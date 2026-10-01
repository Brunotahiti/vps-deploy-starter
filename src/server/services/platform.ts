import { prisma } from "@/server/db";
import { ApiError } from "@/server/errors";
import { audit } from "@/server/audit";
import { isEmailConfigured } from "@/server/email/mailer";
import { emailSettings } from "./platform-emails";
import { addDays, localDay } from "@/lib/dates";
import { OFFER } from "@/lib/plan";
import { DEMO_ORG_SLUG, accountStatus, type AccountStatus, type PlatformEmailKind } from "@/lib/platform";

/*
 * Console plateforme ManaResto : vue transverse de tous les restaurants (inscriptions, essais, abonnements,
 * activité réelle, e-mails envoyés) et actions du support (statut, blocage, prise en main, message).
 */

const TZ = "Pacific/Tahiti";
const DAY = 86_400_000;
const asDate = (day: string) => new Date(`${day}T00:00:00.000Z`); // colonne DATE : minuit UTC
const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

/** Battement de cœur : +1 minute d'utilisation par utilisateur et par jour, au plus une fois toutes les 45 s. */
export async function recordActivity(organizationId: string, userId: string, now = new Date()) {
  const day = localDay(now, TZ);
  const at = now.toISOString();
  await prisma.$executeRaw`
    INSERT INTO "activity_days" ("id", "organization_id", "user_id", "day", "minutes", "last_at")
    VALUES (gen_random_uuid(), ${organizationId}::uuid, ${userId}::uuid, ${day}::date, 1, (${at}::timestamptz AT TIME ZONE 'UTC'))
    ON CONFLICT ("user_id", "day") DO UPDATE
      SET "minutes" = "activity_days"."minutes" + 1, "last_at" = EXCLUDED."last_at"
      WHERE "activity_days"."last_at" < EXCLUDED."last_at" - interval '45 seconds'`;
}

export type PlatformRow = {
  id: string; name: string; slug: string; isDemo: boolean;
  owner: { firstName: string; lastName: string; email: string } | null;
  establishment: { name: string; slug: string; city: string | null; island: string | null } | null;
  establishments: number; users: number;
  plan: "TRIAL" | "ACTIVE" | "SUSPENDED"; status: AccountStatus; endingSoon: boolean;
  trialEndsAt: string | null; planStartedAt: string | null; periodEndsAt: string | null; billingEmail: string | null;
  blockedAt: string | null; blockedReason: string | null; createdAt: string;
  minutes7: number; minutes30: number; activeDays30: number; lastSeenAt: string | null; lastLoginAt: string | null; orders30: number;
  lastEmail: { kind: PlatformEmailKind; status: string; at: string } | null; emailsTotal: number;
  publicPath: string | null;
};

export async function platformOverview(now = new Date()) {
  const today = localDay(now, TZ);
  const d7 = addDays(today, -6);
  const d30 = addDays(today, -29);
  const since30 = new Date(now.getTime() - 30 * DAY);

  const [orgs, activity, lastSeen, lastLogin, orders, emailCounts, lastEmails, recentLogins, demoRequests] = await Promise.all([
    prisma.organization.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true, name: true, slug: true, plan: true, trialEndsAt: true, planStartedAt: true, periodEndsAt: true, billingEmail: true, blockedAt: true, blockedReason: true, createdAt: true,
        users: { where: { isOwner: true }, orderBy: { createdAt: "asc" }, take: 1, select: { firstName: true, lastName: true, email: true } },
        establishments: { where: { isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, slug: true, city: true, island: true } },
        _count: { select: { users: true } },
      },
    }),
    prisma.activityDay.groupBy({ by: ["organizationId", "day"], where: { day: { gte: asDate(d30) } }, _sum: { minutes: true } }),
    prisma.activityDay.groupBy({ by: ["organizationId"], _max: { lastAt: true } }),
    prisma.user.groupBy({ by: ["organizationId"], _max: { lastLoginAt: true } }),
    prisma.order.groupBy({ by: ["establishmentId"], where: { createdAt: { gte: since30 } }, _count: { _all: true } }),
    prisma.platformEmail.groupBy({ by: ["organizationId"], _count: { _all: true } }),
    prisma.platformEmail.findMany({ distinct: ["organizationId"], orderBy: [{ organizationId: "asc" }, { createdAt: "desc" }], select: { organizationId: true, kind: true, status: true, createdAt: true } }),
    prisma.user.findMany({ where: { lastLoginAt: { not: null } }, orderBy: { lastLoginAt: "desc" }, take: 15, select: { id: true, firstName: true, lastName: true, email: true, isOwner: true, lastLoginAt: true, organization: { select: { id: true, name: true } } } }),
    prisma.demoRequest.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
  ]);

  const estToOrg = new Map<string, string>();
  for (const o of orgs) for (const e of o.establishments) estToOrg.set(e.id, o.id);
  const orders30 = new Map<string, number>();
  for (const r of orders) { const org = estToOrg.get(r.establishmentId); if (org) orders30.set(org, (orders30.get(org) ?? 0) + r._count._all); }

  const d7Date = asDate(d7).getTime();
  const perOrg = new Map<string, { m7: number; m30: number; days: number }>();
  const perDay = new Map<string, { orgs: Set<string>; minutes: number }>();
  const demoIds = new Set(orgs.filter((o) => o.slug === DEMO_ORG_SLUG).map((o) => o.id));
  for (const a of activity) {
    const m = a._sum.minutes ?? 0;
    const cur = perOrg.get(a.organizationId) ?? { m7: 0, m30: 0, days: 0 };
    cur.m30 += m; cur.days += 1;
    if (a.day.getTime() >= d7Date) cur.m7 += m;
    perOrg.set(a.organizationId, cur);
    if (demoIds.has(a.organizationId)) continue;
    const k = dayKey(a.day);
    const d = perDay.get(k) ?? { orgs: new Set<string>(), minutes: 0 };
    d.orgs.add(a.organizationId); d.minutes += m;
    perDay.set(k, d);
  }
  const seen = new Map(lastSeen.map((r) => [r.organizationId, r._max.lastAt]));
  const logins = new Map(lastLogin.map((r) => [r.organizationId, r._max.lastLoginAt]));
  const emailsTotal = new Map(emailCounts.map((r) => [r.organizationId, r._count._all]));
  const lastEmail = new Map(lastEmails.map((r) => [r.organizationId, r]));

  const rows: PlatformRow[] = orgs.map((o) => {
    const act = perOrg.get(o.id);
    const owner = o.users[0] ?? null;
    const est = o.establishments[0] ?? null;
    const login = logins.get(o.id) ?? null;
    const beat = seen.get(o.id) ?? null;
    const last = [login, beat].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    const le = lastEmail.get(o.id);
    return {
      id: o.id, name: o.name, slug: o.slug, isDemo: o.slug === DEMO_ORG_SLUG,
      owner, establishment: est ? { name: est.name, slug: est.slug, city: est.city, island: est.island } : null,
      establishments: o.establishments.length, users: o._count.users,
      plan: o.plan, status: accountStatus(o, now),
      endingSoon: accountStatus(o, now) === "TRIAL" && !!o.trialEndsAt && o.trialEndsAt.getTime() - now.getTime() <= 3 * DAY,
      trialEndsAt: o.trialEndsAt?.toISOString() ?? null, planStartedAt: o.planStartedAt?.toISOString() ?? null, periodEndsAt: o.periodEndsAt?.toISOString() ?? null, billingEmail: o.billingEmail,
      blockedAt: o.blockedAt?.toISOString() ?? null, blockedReason: o.blockedReason, createdAt: o.createdAt.toISOString(),
      minutes7: act?.m7 ?? 0, minutes30: act?.m30 ?? 0, activeDays30: act?.days ?? 0,
      lastSeenAt: last?.toISOString() ?? null, lastLoginAt: login?.toISOString() ?? null, orders30: orders30.get(o.id) ?? 0,
      lastEmail: le ? { kind: le.kind as PlatformEmailKind, status: le.status, at: le.createdAt.toISOString() } : null,
      emailsTotal: emailsTotal.get(o.id) ?? 0,
      publicPath: est ? `/site/${o.slug}/${est.slug}` : null,
    };
  });

  // Indicateurs (hors compte de démonstration)
  const real = rows.filter((r) => !r.isDemo);
  const created = (from: number, to: number) => real.filter((r) => { const t = new Date(r.createdAt).getTime(); return t >= from && t < to; }).length;
  const signups7 = created(now.getTime() - 7 * DAY, now.getTime() + 1);
  const signups30 = created(now.getTime() - 30 * DAY, now.getTime() + 1);
  const signupsPrev30 = created(now.getTime() - 60 * DAY, now.getTime() - 30 * DAY);
  const count = (s: AccountStatus) => real.filter((r) => r.status === s).length;
  const active = count("ACTIVE");
  const kpis = {
    restaurants: real.length,
    signups7, signups30, signupsPrev30,
    trials: count("TRIAL"), expired: count("EXPIRED"), active, suspended: count("SUSPENDED"), blocked: count("BLOCKED"),
    mrr: active * OFFER.monthly,
    arr: active * OFFER.monthly * 12,
    conversion: pct(active, real.length),
    active7: real.filter((r) => r.minutes7 > 0).length,
    minutes7: real.reduce((s, r) => s + r.minutes7, 0),
    trialsEndingSoon: real.filter((r) => r.endingSoon).length,
    demoNew: demoRequests.filter((d) => d.status === "NEW").length,
    demoTotal: demoRequests.length,
  };

  const series = Array.from({ length: 30 }, (_, i) => {
    const day = addDays(d30, i);
    const from = new Date(`${day}T00:00:00.000Z`).getTime();
    const signups = real.filter((r) => localDay(new Date(r.createdAt), TZ) === day).length;
    const d = perDay.get(day);
    return { day, signups, activeOrgs: d?.orgs.size ?? 0, minutes: d?.minutes ?? 0, ts: from };
  });

  return {
    generatedAt: now.toISOString(), // référence des périodes (7 j, 30 j) pour le détail des indicateurs
    kpis,
    series,
    rows,
    recentLogins: recentLogins.map((u) => ({ id: u.id, name: `${u.firstName} ${u.lastName}`.trim(), email: u.email, isOwner: u.isOwner, at: u.lastLoginAt!.toISOString(), organization: u.organization })),
    demoRequests: demoRequests.map((d) => ({ id: d.id, restaurantName: d.restaurantName, contactName: d.contactName, phone: d.phone, email: d.email, commune: d.commune, kind: d.kind, message: d.message, status: d.status, emailSent: d.emailSent, createdAt: d.createdAt.toISOString() })),
    emailConfigured: isEmailConfigured(),
    email: emailSettings(),
    offer: { monthly: OFFER.monthly, trialDays: OFFER.trialDays, commitmentMonths: OFFER.commitmentMonths },
  };
}

/** Fiche détaillée d'un restaurant : équipe, connexions, activité jour par jour, e-mails, volumes. */
export async function platformOrgDetail(organizationId: string, now = new Date()) {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    include: {
      establishments: { orderBy: { createdAt: "asc" }, select: { id: true, name: true, slug: true, city: true, island: true, phone: true, email: true, isActive: true, onboardingDone: true, createdAt: true } },
      users: { orderBy: [{ isOwner: "desc" }, { createdAt: "asc" }], select: { id: true, firstName: true, lastName: true, email: true, isOwner: true, isActive: true, lastLoginAt: true, inviteToken: true, createdAt: true } },
      platformEmails: { orderBy: { createdAt: "desc" }, take: 30 },
    },
  });
  if (!org) throw new ApiError(404, "NOT_FOUND", "Restaurant introuvable");
  const today = localDay(now, TZ);
  const d30 = addDays(today, -29);
  const estIds = org.establishments.map((e) => e.id);
  const userIds = org.users.map((u) => u.id);
  const [activity, sessions, products, tables, ordersTotal, orders30, lastOrder] = await Promise.all([
    prisma.activityDay.groupBy({ by: ["day"], where: { organizationId, day: { gte: asDate(d30) } }, _sum: { minutes: true } }),
    prisma.session.findMany({ where: { userId: { in: userIds }, expiresAt: { gt: now } }, orderBy: { lastSeenAt: "desc" }, take: 20, select: { id: true, userId: true, userAgent: true, createdAt: true, lastSeenAt: true, impersonatorId: true } }),
    prisma.product.count({ where: { establishmentId: { in: estIds } } }),
    prisma.table.count({ where: { establishmentId: { in: estIds } } }),
    prisma.order.count({ where: { establishmentId: { in: estIds } } }),
    prisma.order.count({ where: { establishmentId: { in: estIds }, createdAt: { gte: new Date(now.getTime() - 30 * DAY) } } }),
    prisma.order.findFirst({ where: { establishmentId: { in: estIds } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  const perUser = await prisma.activityDay.groupBy({ by: ["userId"], where: { organizationId, day: { gte: asDate(d30) } }, _sum: { minutes: true }, _max: { lastAt: true } });
  const userAct = new Map(perUser.map((r) => [r.userId, r]));
  const byDay = new Map(activity.map((a) => [dayKey(a.day), a._sum.minutes ?? 0]));
  const names = new Map(org.users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
  return {
    id: org.id, name: org.name, slug: org.slug, status: accountStatus(org, now), plan: org.plan,
    trialEndsAt: org.trialEndsAt?.toISOString() ?? null, planStartedAt: org.planStartedAt?.toISOString() ?? null, periodEndsAt: org.periodEndsAt?.toISOString() ?? null,
    blockedAt: org.blockedAt?.toISOString() ?? null, blockedReason: org.blockedReason, createdAt: org.createdAt.toISOString(), billingEmail: org.billingEmail,
    establishments: org.establishments.map((e) => ({ ...e, createdAt: e.createdAt.toISOString(), publicPath: `/site/${org.slug}/${e.slug}` })),
    users: org.users.map((u) => ({ id: u.id, name: `${u.firstName} ${u.lastName}`.trim(), email: u.email, isOwner: u.isOwner, isActive: u.isActive, invitePending: !!u.inviteToken, lastLoginAt: u.lastLoginAt?.toISOString() ?? null, minutes30: userAct.get(u.id)?._sum.minutes ?? 0, lastSeenAt: userAct.get(u.id)?._max.lastAt?.toISOString() ?? null })),
    sessions: sessions.map((s) => ({ id: s.id, user: names.get(s.userId) ?? "—", device: describeDevice(s.userAgent), createdAt: s.createdAt.toISOString(), lastSeenAt: s.lastSeenAt.toISOString(), support: !!s.impersonatorId })),
    activity: Array.from({ length: 30 }, (_, i) => { const day = addDays(d30, i); return { day, minutes: byDay.get(day) ?? 0 }; }),
    counts: { products, tables, ordersTotal, orders30, lastOrderAt: lastOrder?.createdAt.toISOString() ?? null },
    emails: org.platformEmails.map((e) => ({ id: e.id, kind: e.kind as PlatformEmailKind, to: e.to, subject: e.subject, status: e.status, error: e.error, createdAt: e.createdAt.toISOString() })),
  };
}

/** Appareil lisible à partir du user-agent (« iPad · Safari », « Windows · Chrome »). */
export function describeDevice(ua: string | null): string {
  if (!ua) return "Appareil inconnu";
  const os = /iPad/.test(ua) ? "iPad" : /iPhone/.test(ua) ? "iPhone" : /Android/.test(ua) ? (/Mobile/.test(ua) ? "Android" : "Tablette Android") : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "Appareil";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Navigateur";
  return `${os} · ${browser}`;
}

type Admin = { id: string; email: string };
const supportReason = (admin: Admin, detail?: string | null) => `Console ManaResto (${admin.email})${detail ? ` : ${detail}` : ""}`;

/** Change le statut d'abonnement : essai (avec date de fin), actif (période d'engagement) ou suspendu. */
export async function setOrganizationPlan(organizationId: string, input: { plan: "TRIAL" | "ACTIVE" | "SUSPENDED"; trialEndsAt?: string | null; periodEndsAt?: string | null }, admin: Admin, now = new Date()) {
  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!org) throw new ApiError(404, "NOT_FOUND", "Restaurant introuvable");
  const data: { plan: typeof input.plan; trialEndsAt?: Date; planStartedAt?: Date; periodEndsAt?: Date | null } = { plan: input.plan };
  if (input.plan === "TRIAL") {
    const ends = input.trialEndsAt ? new Date(input.trialEndsAt) : new Date(now.getTime() + OFFER.trialDays * DAY);
    if (Number.isNaN(ends.getTime())) throw new ApiError(400, "INVALID_DATE", "Date de fin d'essai invalide");
    data.trialEndsAt = ends;
  }
  if (input.plan === "ACTIVE") {
    if (org.plan !== "ACTIVE") data.planStartedAt = now;
    const start = data.planStartedAt ?? org.planStartedAt ?? now;
    const ends = input.periodEndsAt ? new Date(input.periodEndsAt) : new Date(new Date(start).setMonth(start.getMonth() + OFFER.commitmentMonths));
    if (Number.isNaN(ends.getTime())) throw new ApiError(400, "INVALID_DATE", "Date de fin de période invalide");
    data.periodEndsAt = ends;
  }
  const updated = await prisma.organization.update({ where: { id: organizationId }, data });
  await audit({ organizationId, action: "platform.plan", entityType: "organization", entityId: organizationId, oldValue: { plan: org.plan, trialEndsAt: org.trialEndsAt, periodEndsAt: org.periodEndsAt }, newValue: { plan: updated.plan, trialEndsAt: updated.trialEndsAt, periodEndsAt: updated.periodEndsAt }, reason: supportReason(admin) });
  return { plan: updated.plan, trialEndsAt: updated.trialEndsAt, periodEndsAt: updated.periodEndsAt };
}

/** Bloque (déconnecte tout le monde et refuse les connexions) ou débloque un restaurant. */
export async function setOrganizationBlocked(organizationId: string, blocked: boolean, reason: string | null | undefined, admin: Admin) {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true, blockedAt: true } });
  if (!org) throw new ApiError(404, "NOT_FOUND", "Restaurant introuvable");
  const updated = await prisma.organization.update({ where: { id: organizationId }, data: blocked ? { blockedAt: org.blockedAt ?? new Date(), blockedReason: reason?.trim() || null } : { blockedAt: null, blockedReason: null } });
  if (blocked) await prisma.session.deleteMany({ where: { user: { organizationId }, impersonatorId: null } });
  await audit({ organizationId, action: blocked ? "platform.block" : "platform.unblock", entityType: "organization", entityId: organizationId, reason: supportReason(admin, reason) });
  return { blockedAt: updated.blockedAt };
}

/** Propriétaire à utiliser pour « Prendre la main ». */
export async function impersonationTarget(organizationId: string) {
  const owner = await prisma.user.findFirst({ where: { organizationId, isOwner: true, isActive: true }, orderBy: { createdAt: "asc" } });
  if (!owner) throw new ApiError(404, "NO_OWNER", "Aucun propriétaire actif sur ce compte");
  const est = await prisma.establishment.findFirst({ where: { organizationId, isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
  return { owner, establishmentId: est?.id ?? null };
}

export async function setDemoRequestStatus(id: string, status: "NEW" | "CONTACTED" | "DONE") {
  return prisma.demoRequest.update({ where: { id }, data: { status }, select: { id: true, status: true } });
}
