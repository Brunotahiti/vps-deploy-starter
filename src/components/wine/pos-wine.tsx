"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { GlassWater, Wine } from "lucide-react";
import { api } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { Empty } from "@/components/ui/misc";
import { OpenBottles, WineAdvisor } from "./wine-ui";
import type { OpenBottle } from "./types";

type View = "advisor" | "open";

/** Écran Cave de la caisse (option Cave à vin) : conseiller un vin, suivre les bouteilles ouvertes. */
export function PosWine() {
  const { can, hasOption } = useSession();
  const allowed = hasOption("wine") && (can("wine.use") || can("wine.manage"));
  const [view, setView] = useState<View>("advisor");
  const open = useQuery({ queryKey: ["wine", "open"], queryFn: () => api.get<OpenBottle[]>("/api/wine/open-bottles"), enabled: allowed, refetchInterval: 60_000 });
  if (!allowed) return <div className="p-6"><Empty title="Cave à vin" hint="L'option Cave à vin se débloque dans Gestion → Options." /></div>;
  const overdue = (open.data ?? []).filter((b) => b.overdue).length;
  const views: { key: View; label: string; icon: typeof Wine; alert?: number }[] = [
    { key: "advisor", label: "Conseiller un vin", icon: Wine },
    { key: "open", label: `Vin au verre${open.data?.length ? ` (${open.data.length})` : ""}`, icon: GlassWater, alert: overdue },
  ];
  return (
    <div className="mx-auto max-w-5xl overflow-y-auto p-4">
      <div role="tablist" className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {views.map((v) => (
          <button key={v.key} role="tab" aria-selected={view === v.key} onClick={() => setView(v.key)} className={`touch relative flex h-11 shrink-0 items-center gap-1.5 rounded-xl px-4 text-sm font-bold ${view === v.key ? "bg-rose-800 text-white" : "surface-2"}`}>
            <v.icon className="h-4 w-4" />{v.label}
            {v.alert ? <span className="ml-1 rounded-full bg-red-500 px-1.5 text-[11px] text-white" aria-label={`${v.alert} à écouler`}>{v.alert}</span> : null}
          </button>
        ))}
      </div>
      {view === "advisor" ? <WineAdvisor /> : <OpenBottles />}
    </div>
  );
}
