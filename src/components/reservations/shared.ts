import type { listReservations, lookupCaller } from "@/server/services/reservations";

export type Resa = Awaited<ReturnType<typeof listReservations>>[number];
export type Caller = NonNullable<Awaited<ReturnType<typeof lookupCaller>>>;
export type DaySummary = { day: string; count: number; covers: number; pending: number };

export const STATUS: Record<string, { label: string; dot: string; soft: string; text: string }> = {
  PENDING: { label: "À confirmer", dot: "#f59e0b", soft: "bg-amber-500/15", text: "text-amber-700 dark:text-amber-300" },
  CONFIRMED: { label: "Confirmée", dot: "#3b82f6", soft: "bg-blue-500/15", text: "text-blue-700 dark:text-blue-300" },
  ARRIVED: { label: "Arrivée", dot: "#14aaa3", soft: "bg-teal-500/15", text: "text-teal-700 dark:text-teal-300" },
  SEATED: { label: "Installée", dot: "#22c55e", soft: "bg-green-500/15", text: "text-green-700 dark:text-green-300" },
  COMPLETED: { label: "Terminée", dot: "#94a3b8", soft: "bg-slate-500/15", text: "text-slate-600 dark:text-slate-300" },
  CANCELLED: { label: "Annulée", dot: "#ef4444", soft: "bg-red-500/10", text: "text-red-600 dark:text-red-300" },
  NO_SHOW: { label: "Absent", dot: "#ef4444", soft: "bg-red-500/10", text: "text-red-600 dark:text-red-300" },
};

/** Réservation qui compte dans les couverts attendus */
export const counts = (r: { status: string }) => r.status !== "CANCELLED" && r.status !== "NO_SHOW";

/** Heure locale « HH:mm » d'un instant, dans le fuseau de l'établissement */
export function hhmmOf(date: Date | string, timeZone: string) {
  return new Intl.DateTimeFormat("fr-FR", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(date));
}
export const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** « vendredi 3 octobre » */
export function longDay(day: string) {
  return new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
}
export function shortWeekday(day: string) {
  return new Intl.DateTimeFormat("fr-FR", { weekday: "short", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`)).replace(".", "");
}
export const dayNumber = (day: string) => Number(day.slice(8, 10));

/** « 19 h 30 » : l'heure telle qu'on la dit au téléphone */
export const spokenTime = (hhmm: string) => `${Number(hhmm.slice(0, 2))} h${hhmm.slice(3) === "00" ? "" : ` ${hhmm.slice(3)}`}`;
