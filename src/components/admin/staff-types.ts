import { dateToZonedInput, zonedInputToDate } from "@/lib/dates";
import type { listEmployees, listShifts, listEntries, staffSummary, presentNow, clockStatus } from "@/server/services/staff";
import type { PeriodReport } from "@/server/services/reports";

export type Employee = Awaited<ReturnType<typeof listEmployees>>[number];
export type Shift = Awaited<ReturnType<typeof listShifts>>[number];
export type TimeEntry = Awaited<ReturnType<typeof listEntries>>[number];
export type StaffSummary = Awaited<ReturnType<typeof staffSummary>>;
export type Present = Awaited<ReturnType<typeof presentNow>>[number];
export type ClockStatus = Awaited<ReturnType<typeof clockStatus>>;
export type { PeriodReport };
export const CLOCK_LABEL: Record<string, string> = { CLOCK_IN: "Arrivée", BREAK_START: "Pause", BREAK_END: "Reprise", CLOCK_OUT: "Départ" };
export const fmtHours = (h: number) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`; };
// Saisies à l'heure de l'établissement (et non de l'appareil : un gérant en déplacement saisit l'heure de Tahiti)
export const toLocalInput = (d: Date | string, timeZone = "Pacific/Tahiti") => dateToZonedInput(d, timeZone);
export const fromLocalInput = (s: string, timeZone = "Pacific/Tahiti") => zonedInputToDate(s, timeZone).toISOString();
