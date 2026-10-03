/*
 * Happy hour (option Bar) : créneaux de prix réduits par jour et heure locale, sur des catégories ou des boissons choisies.
 * Fonctions pures, partagées par le serveur (prix à l'ajout d'un article) et la caisse (bandeau « happy hour en cours »).
 */

export type HappyHour = { id: string; name: string; days: number[]; start: string; end: string; discountBps: number; categoryIds: string[]; productIds: string[]; enabled: boolean };
export type BarSettings = { happyHours: HappyHour[] };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function normalizeBarSettings(raw: unknown): BarSettings {
  const r = (raw ?? {}) as { happyHours?: unknown };
  const list = Array.isArray(r.happyHours) ? r.happyHours : [];
  const happyHours = list.flatMap((h): HappyHour[] => {
    const x = h as Partial<HappyHour>;
    if (!x || typeof x.id !== "string" || !HHMM.test(x.start ?? "") || !HHMM.test(x.end ?? "")) return [];
    const bps = Math.round(Number(x.discountBps));
    if (!(bps > 0 && bps <= 10000)) return [];
    return [{
      id: x.id, name: (x.name ?? "Happy hour").toString().slice(0, 40) || "Happy hour",
      days: Array.isArray(x.days) ? [...new Set(x.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [],
      start: x.start!, end: x.end!, discountBps: bps,
      categoryIds: Array.isArray(x.categoryIds) ? x.categoryIds.filter((c): c is string => typeof c === "string") : [],
      productIds: Array.isArray(x.productIds) ? x.productIds.filter((c): c is string => typeof c === "string") : [],
      enabled: x.enabled !== false,
    }];
  });
  return { happyHours };
}

/** Jour de la semaine (0 = dimanche) et minutes depuis minuit, à l'heure locale de l'établissement. */
function localClock(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { day, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}
const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Le créneau est-il en cours à cet instant ? (un créneau qui passe minuit est rattaché au jour où il commence) */
export function isHappyHourOn(h: HappyHour, timeZone: string, at: Date): boolean {
  if (!h.enabled) return false;
  const { day, minutes } = localClock(at, timeZone);
  const prev = (day + 6) % 7;
  const s = toMinutes(h.start), e = toMinutes(h.end);
  return s < e ? h.days.includes(day) && minutes >= s && minutes < e : (h.days.includes(day) && minutes >= s) || (h.days.includes(prev) && minutes < e);
}

/** Happy hour en cours pour ce produit (sa catégorie ou le produit lui-même) ; deux créneaux en même temps : le plus avantageux. */
export function activeHappyHour(settings: BarSettings, timeZone: string, at: Date, product: { id?: string | null; categoryId: string | null }): HappyHour | null {
  let best: HappyHour | null = null;
  for (const h of settings.happyHours) {
    const concerned = (!!product.categoryId && h.categoryIds.includes(product.categoryId)) || (!!product.id && h.productIds.includes(product.id));
    if (concerned && isHappyHourOn(h, timeZone, at) && (!best || h.discountBps > best.discountBps)) best = h;
  }
  return best;
}
