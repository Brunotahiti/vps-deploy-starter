import type { ForecastLevel } from "@/server/services/forecast";

/** Couleurs façon Bison Futé des prévisions de fréquentation */
export const LEVEL_LOOK: Record<ForecastLevel, { label: string; emoji: string; band: string; soft: string; text: string }> = {
  green: { label: "Calme", emoji: "🟢", band: "bg-emerald-500", soft: "bg-emerald-500/10", text: "text-emerald-700 dark:text-emerald-300" },
  orange: { label: "Soutenu", emoji: "🟠", band: "bg-amber-500", soft: "bg-amber-500/10", text: "text-amber-700 dark:text-amber-300" },
  red: { label: "Chargé", emoji: "🔴", band: "bg-red-500", soft: "bg-red-500/10", text: "text-red-700 dark:text-red-300" },
  black: { label: "Très chargé", emoji: "⚫", band: "bg-slate-900 dark:bg-black", soft: "bg-slate-900/10 dark:bg-white/10", text: "text-slate-900 dark:text-white" },
};
