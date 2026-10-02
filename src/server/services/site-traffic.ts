import { prisma } from "@/server/db";
import { sha256 } from "@/server/auth/password";
import { addDays, localDay, startOfLocalDay } from "@/lib/dates";
import { DEMO_ORG_SLUG } from "@/lib/platform";

/*
 * Fréquentation du site vitrine et de l'application, pour le tableau de bord de la console plateforme.
 * Mesure anonyme sans cookie : ni adresse IP ni user-agent ne sont conservés. Un visiteur est reconnu
 * le temps d'une journée par une empreinte tronquée (adresse + navigateur + jour + secret), puis oublié.
 */

const TZ = "Pacific/Tahiti";
const KEEP_DAYS = 400; // ~13 mois
const OWN_HOSTS = /(^|\.)manaresto\.(com|pf)$|^localhost$|^127\.0\.0\.1$/;
const BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|pagespeed|facebookexternalhit|embedly|curl|wget|python|go-http|java\/|axios|node-fetch|monitor|uptime/i;

export type LoginMethod = "password" | "pin" | "invite" | "offline" | "box";

export function isBot(ua: string | null | undefined) {
  return !ua || BOT.test(ua);
}

export function deviceOf(ua: string | null | undefined): "mobile" | "tablet" | "desktop" {
  if (!ua) return "desktop";
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return "tablet";
  if (/Mobi|iPhone|iPod|Android/i.test(ua)) return "mobile";
  return "desktop";
}

/** Empreinte du jour : la même personne est comptée une fois par jour, sans pouvoir être suivie d'un jour à l'autre. */
export function visitorOf(ip: string, ua: string, now = new Date()) {
  return sha256(`${ip}|${ua}|${localDay(now, TZ)}|${process.env.SESSION_SECRET ?? "manaresto"}`).slice(0, 16);
}

/** Domaine d'origine d'une visite (sans les pages du site lui-même). */
export function referrerDomain(referrer: string | null | undefined): string | null {
  if (!referrer) return null;
  try {
    const host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, "");
    return host && !OWN_HOSTS.test(host) ? host.slice(0, 80) : null;
  } catch {
    return null;
  }
}

/** Chemin de page propre : sans paramètres, sans « .html », « / » pour l'accueil. */
export function cleanPath(path: string | null | undefined): string {
  const p = String(path || "/").split(/[?#]/)[0].replace(/\/index(\.html)?$/, "/").replace(/\.html$/, "");
  return (p.startsWith("/") ? p : `/${p}`).slice(0, 120) || "/";
}

const slug = (v: unknown, max = 40) => (typeof v === "string" && v.trim() ? v.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").slice(0, max) : null);

/** Page vue ou clic sur le site vitrine (balise envoyée par le navigateur). Les robots sont ignorés. */
export async function recordSiteHit(input: { type?: unknown; name?: unknown; path?: unknown; referrer?: unknown; utmSource?: unknown; utmCampaign?: unknown }, meta: { ip: string; ua: string | null }, now = new Date()) {
  if (isBot(meta.ua)) return false;
  const kind = input.type === "click" ? "click" : "view";
  const method = kind === "click" ? slug(input.name, 30) : null;
  if (kind === "click" && !method) return false;
  await prisma.siteEvent.create({
    data: {
      at: now, kind, method,
      path: cleanPath(typeof input.path === "string" ? input.path : "/"),
      referrer: kind === "view" ? referrerDomain(typeof input.referrer === "string" ? input.referrer : null) : null,
      device: deviceOf(meta.ua),
      visitor: visitorOf(meta.ip, meta.ua ?? "", now),
      utmSource: slug(input.utmSource), utmCampaign: slug(input.utmCampaign),
    },
  });
  return true;
}

/** Connexion, inscription ou visite de la démo (côté serveur). Ne bloque jamais l'ouverture de session. */
export async function recordAppEvent(kind: "login" | "signup" | "demo", input: { userId?: string | null; organizationId?: string | null; method?: string | null; ua?: string | null }, now = new Date()) {
  try {
    let organizationId = input.organizationId ?? null;
    if (!organizationId && input.userId) organizationId = (await prisma.user.findUnique({ where: { id: input.userId }, select: { organizationId: true } }))?.organizationId ?? null;
    await prisma.siteEvent.create({ data: { at: now, kind, method: input.method ?? null, device: input.ua ? deviceOf(input.ua) : null, userId: input.userId ?? null, organizationId } });
  } catch (e) {
    console.error("[fréquentation] événement non enregistré", e);
  }
}

// ---------------------------------------------------------------------------
// Tableau de bord
// ---------------------------------------------------------------------------

type Count = { k: string | null; n: number };
const iso = (d: Date) => d.toISOString();
const LOCAL = `(("at" AT TIME ZONE 'UTC') AT TIME ZONE '${TZ}')`;
const T = (n: number) => `($${n}::timestamptz AT TIME ZONE 'UTC')`; // colonne en UTC sans fuseau

export type TrafficStats = Awaited<ReturnType<typeof trafficStats>>;

/** Statistiques sur `days` jours (jour en cours inclus), comparées à la période précédente de même durée. */
export async function trafficStats(days: number, now = new Date()) {
  const today = localDay(now, TZ);
  const firstDay = addDays(today, -(days - 1));
  const since = startOfLocalDay(firstDay, TZ);
  const prevSince = startOfLocalDay(addDays(firstDay, -days), TZ);
  const demoOrg = await prisma.organization.findUnique({ where: { slug: DEMO_ORG_SLUG }, select: { id: true } });
  const notDemo = demoOrg?.id ?? "00000000-0000-0000-0000-000000000000";

  // Ménage : au-delà de 13 mois, les événements sont supprimés
  await prisma.siteEvent.deleteMany({ where: { at: { lt: new Date(now.getTime() - KEEP_DAYS * 86_400_000) } } });

  const q = <T>(sql: string, ...params: unknown[]) => prisma.$queryRawUnsafe<T[]>(sql, ...params);
  const top = (kind: string, column: string, limit = 8) =>
    q<Count>(`SELECT ${column} AS k, COUNT(*)::int AS n FROM "site_events" WHERE "kind" = $1 AND "at" >= ${T(2)} GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT ${limit}`, kind, iso(since));

  const [daily, totals, prevTotals, viewGrid, loginHours, pages, referrers, devices, utm, clicks, loginMethods, loginDevices, topOrgs, recent, live] = await Promise.all([
    q<{ day: string; kind: string; n: number; visits: number }>(
      `SELECT to_char(${LOCAL}, 'YYYY-MM-DD') AS day, "kind", COUNT(*)::int AS n, COUNT(DISTINCT "visitor")::int AS visits
       FROM "site_events" WHERE "at" >= ${T(1)} GROUP BY 1, 2`, iso(since)),
    q<{ kind: string; n: number; visits: number; users: number }>(
      `SELECT "kind", COUNT(*)::int AS n, COUNT(DISTINCT ("visitor", to_char(${LOCAL}, 'YYYY-MM-DD')))::int AS visits, COUNT(DISTINCT "user_id")::int AS users
       FROM "site_events" WHERE "at" >= ${T(1)} GROUP BY 1`, iso(since)),
    q<{ kind: string; n: number; visits: number; users: number }>(
      `SELECT "kind", COUNT(*)::int AS n, COUNT(DISTINCT ("visitor", to_char(${LOCAL}, 'YYYY-MM-DD')))::int AS visits, COUNT(DISTINCT "user_id")::int AS users
       FROM "site_events" WHERE "at" >= ${T(1)} AND "at" < ${T(2)} GROUP BY 1`, iso(prevSince), iso(since)),
    q<{ dow: number; hour: number; n: number }>(
      `SELECT EXTRACT(ISODOW FROM ${LOCAL})::int AS dow, EXTRACT(HOUR FROM ${LOCAL})::int AS hour, COUNT(*)::int AS n
       FROM "site_events" WHERE "kind" = 'view' AND "at" >= ${T(1)} GROUP BY 1, 2`, iso(since)),
    q<{ hour: number; n: number }>(
      `SELECT EXTRACT(HOUR FROM ${LOCAL})::int AS hour, COUNT(*)::int AS n
       FROM "site_events" WHERE "kind" = 'login' AND "at" >= ${T(1)} GROUP BY 1`, iso(since)),
    top("view", `"path"`),
    top("view", `"referrer"`),
    top("view", `"device"`, 3),
    top("view", `"utm_source"`),
    top("click", `"method"`, 10),
    top("login", `"method"`, 6),
    top("login", `"device"`, 3),
    q<{ id: string; name: string; n: number; users: number }>(
      `SELECT o."id", o."name", COUNT(*)::int AS n, COUNT(DISTINCT e."user_id")::int AS users
       FROM "site_events" e JOIN "organizations" o ON o."id" = e."organization_id"
       WHERE e."kind" = 'login' AND e."at" >= ${T(1)} AND o."id" <> $2::uuid GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 8`, iso(since), notDemo),
    prisma.siteEvent.findMany({ where: { kind: { in: ["login", "signup"] } }, orderBy: { at: "desc" }, take: 12, select: { at: true, kind: true, method: true, device: true, userId: true, organizationId: true } }),
    q<{ visitors: number; views: number; logins: number }>(
      `SELECT COUNT(DISTINCT "visitor") FILTER (WHERE "kind" = 'view')::int AS visitors, COUNT(*) FILTER (WHERE "kind" = 'view')::int AS views,
              COUNT(*) FILTER (WHERE "kind" = 'login')::int AS logins
       FROM "site_events" WHERE "at" >= ${T(1)}`, iso(new Date(now.getTime() - 30 * 60_000))),
  ]);

  const [users, orgs] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: recent.map((r) => r.userId).filter((v): v is string => !!v) } }, select: { id: true, firstName: true, lastName: true, email: true } }),
    prisma.organization.findMany({ where: { id: { in: recent.map((r) => r.organizationId).filter((v): v is string => !!v) } }, select: { id: true, name: true } }),
  ]);
  const userById = new Map(users.map((u) => [u.id, u]));
  const orgById = new Map(orgs.map((o) => [o.id, o.name]));

  const sum = (rows: typeof totals) => {
    const by = (k: string) => rows.find((r) => r.kind === k);
    return {
      visits: by("view")?.visits ?? 0, views: by("view")?.n ?? 0, clicks: by("click")?.n ?? 0,
      logins: by("login")?.n ?? 0, activeUsers: by("login")?.users ?? 0, signups: by("signup")?.n ?? 0, demos: by("demo")?.n ?? 0,
    };
  };

  const dayList = Array.from({ length: days }, (_, i) => addDays(firstDay, i));
  const perDay = (kind: string, field: "n" | "visits") => dayList.map((d) => daily.find((r) => r.day === d && r.kind === kind)?.[field] ?? 0);
  const grid = Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, h) => viewGrid.find((c) => c.dow === d + 1 && c.hour === h)?.n ?? 0));

  return {
    days, firstDay, today,
    totals: sum(totals), previous: sum(prevTotals),
    series: { days: dayList, visits: perDay("view", "visits"), views: perDay("view", "n"), logins: perDay("login", "n"), signups: perDay("signup", "n"), demos: perDay("demo", "n") },
    viewGrid: grid, // [lundi..dimanche][0..23 h], heure de Tahiti
    loginHours: Array.from({ length: 24 }, (_, h) => loginHours.find((r) => r.hour === h)?.n ?? 0),
    pages, referrers, devices, utm, clicks, loginMethods, loginDevices, topOrgs,
    recent: recent.map((r) => {
      const u = r.userId ? userById.get(r.userId) : undefined;
      return { at: r.at.toISOString(), kind: r.kind, method: r.method, device: r.device, user: u ? [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email : null, organization: r.organizationId ? orgById.get(r.organizationId) ?? null : null };
    }),
    live: live[0] ?? { visitors: 0, views: 0, logins: 0 },
  };
}
