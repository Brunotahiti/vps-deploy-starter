/** Date locale (YYYY-MM-DD) dans le fuseau de l'établissement. */
export function localDay(date: Date, timeZone = "Pacific/Tahiti"): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Début (UTC) d'un jour local donné (YYYY-MM-DD) dans un fuseau. */
export function startOfLocalDay(day: string, timeZone = "Pacific/Tahiti"): Date {
  // Approche robuste sans bibliothèque : on cherche l'instant UTC dont la date locale correspond.
  const [y, m, d] = day.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  // décalage du fuseau à cet instant
  const offsetMin = tzOffsetMinutes(new Date(guess), timeZone);
  return new Date(guess - offsetMin * 60 * 1000);
}

export function endOfLocalDay(day: string, timeZone = "Pacific/Tahiti"): Date {
  return new Date(startOfLocalDay(day, timeZone).getTime() + 24 * 3600 * 1000);
}

export function tzOffsetMinutes(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return (asUtc - date.getTime()) / 60000;
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function formatTime(date: Date | string, timeZone = "Pacific/Tahiti", locale = "fr-FR"): string {
  return new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(date));
}

export function formatDateTime(date: Date | string, timeZone = "Pacific/Tahiti", locale = "fr-FR"): string {
  return new Intl.DateTimeFormat(locale, { timeZone, dateStyle: "short", timeStyle: "short" }).format(new Date(date));
}

export function formatDate(date: Date | string, timeZone = "Pacific/Tahiti", locale = "fr-FR"): string {
  return new Intl.DateTimeFormat(locale, { timeZone, dateStyle: "medium" }).format(new Date(date));
}

/** Durée écoulée "1 h 05" / "12 min". */
export function formatElapsed(since: Date | string, now = new Date()): string {
  const min = Math.max(0, Math.floor((now.getTime() - new Date(since).getTime()) / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${String(min % 60).padStart(2, "0")}`;
}
