import { BarChart3, BookUser, Boxes, BrainCircuit, Globe2, Martini, Megaphone, PartyPopper, Rocket, ShieldCheck, ThermometerSnowflake, Tv, UsersRound, Wine, type LucideIcon } from "lucide-react";
import type { OptionKey } from "@/lib/options";

/** Icône et dégradé de chaque option (page Options, visionneuse, présentations). */
export const OPTION_LOOK: Record<OptionKey, { icon: LucideIcon; tile: string }> = {
  stock: { icon: Boxes, tile: "from-emerald-400 to-emerald-600" },
  digital: { icon: Globe2, tile: "from-sky-400 to-indigo-600" },
  team: { icon: UsersRound, tile: "from-amber-400 to-orange-600" },
  stats: { icon: BarChart3, tile: "from-cyan-400 to-blue-600" },
  continuity: { icon: ShieldCheck, tile: "from-rose-400 to-red-600" },
  ai: { icon: BrainCircuit, tile: "from-fuchsia-500 to-purple-700" },
  hygiene: { icon: ThermometerSnowflake, tile: "from-teal-400 to-cyan-700" },
  accounts: { icon: BookUser, tile: "from-slate-500 to-slate-800" },
  marketing: { icon: Megaphone, tile: "from-pink-500 to-rose-600" },
  screens: { icon: Tv, tile: "from-indigo-400 to-sky-600" },
  bar: { icon: Martini, tile: "from-fuchsia-500 to-rose-600" },
  wine: { icon: Wine, tile: "from-rose-700 to-red-900" },
  catering: { icon: PartyPopper, tile: "from-amber-400 to-rose-600" },
  advanced: { icon: Rocket, tile: "from-violet-500 to-fuchsia-600" },
};

export const optionPrice = (n: number) => `${n.toLocaleString("fr-FR").replace(/\u202f/g, "\u00a0")} F CFP / mois`;
