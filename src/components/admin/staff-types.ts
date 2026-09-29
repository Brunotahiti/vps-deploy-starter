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
export const toLocalInput = (d: Date | string) => { const x = new Date(d); const p = (n: number) => String(n).padStart(2, "0"); return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}`; };
export const fromLocalInput = (s: string) => new Date(s).toISOString();
