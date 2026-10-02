"use client";

import { useQuery } from "@tanstack/react-query";
import { BarChart3, BookUser, Boxes, Megaphone, BrainCircuit, CheckCircle2, Clock, Globe2, Rocket, ShieldCheck, Sparkles, ThermometerSnowflake, UsersRound, Wallet } from "lucide-react";
import { api } from "@/lib/api-client";
import { PageHeader, useAction } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/misc";
import { formatDate } from "@/lib/dates";
import type { OptionKey } from "@/lib/options";

type Option = { key: OptionKey; label: string; tagline: string; includes: string[]; enabled: boolean; monthly: number | null; requestedAt: string | null };

const LOOK: Record<OptionKey, { icon: typeof Boxes; tile: string }> = {
  stock: { icon: Boxes, tile: "from-emerald-400 to-emerald-600" },
  digital: { icon: Globe2, tile: "from-sky-400 to-indigo-600" },
  team: { icon: UsersRound, tile: "from-amber-400 to-orange-600" },
  stats: { icon: BarChart3, tile: "from-cyan-400 to-blue-600" },
  continuity: { icon: ShieldCheck, tile: "from-rose-400 to-red-600" },
  ai: { icon: BrainCircuit, tile: "from-fuchsia-500 to-purple-700" },
  hygiene: { icon: ThermometerSnowflake, tile: "from-teal-400 to-cyan-700" },
  accounts: { icon: BookUser, tile: "from-slate-500 to-slate-800" },
  marketing: { icon: Megaphone, tile: "from-pink-500 to-rose-600" },
  advanced: { icon: Rocket, tile: "from-violet-500 to-fuchsia-600" },
};
const BASE = ["Caisse et encaissement (espèces, carte, addition partagée)", "Plan de salle ou vente au comptoir", "Réservations par téléphone, liste du jour et calendrier", "Écran cuisine et bons imprimés", "Tickets, clôture de caisse et rapports du jour"];
const price = (n: number) => `${n.toLocaleString("fr-FR").replace(/ /g, " ")} F CFP / mois`;

/** Programme de base + options payantes : ce qui est actif, ce qu'on peut débloquer (demande à l'équipe ManaResto). */
export default function OptionsPage() {
  const act = useAction();
  const q = useQuery({ queryKey: ["options"], queryFn: () => api.get<Option[]>("/api/options") });
  const unlock = (o: Option) => act(() => api.post("/api/options/request", { option: o.key }), { success: "Demande envoyée : l'équipe ManaResto vous recontacte rapidement", invalidate: [["options"]] });

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Options" subtitle="Le programme de base suffit pour bien démarrer. Ajoutez seulement ce dont vous avez besoin." />
      <section className="card mb-5 flex flex-col gap-3 p-5 sm:flex-row sm:items-center" data-testid="base-program">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-lagon-400 to-lagon-600 text-white shadow-glow"><Wallet className="h-6 w-6" /></span>
        <div className="flex-1">
          <p className="text-base font-extrabold">Programme de base <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-bold text-green-700 dark:text-green-400"><CheckCircle2 className="h-3.5 w-3.5" />inclus</span></p>
          <ul className="mt-1 grid gap-x-5 gap-y-0.5 text-sm text-muted sm:grid-cols-2">{BASE.map((b) => <li key={b} className="flex items-start gap-1.5"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" />{b}</li>)}</ul>
        </div>
      </section>
      {q.isLoading ? <Spinner /> : (
        <div className="grid gap-4 md:grid-cols-2">
          {q.data?.map((o) => {
            const L = LOOK[o.key];
            return (
              <article key={o.key} className={`card flex flex-col p-5 ${o.enabled ? "ring-2 ring-green-500/40" : ""}`} data-testid={`option-${o.key}`}>
                <div className="flex items-start gap-3">
                  <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-lift ${L.tile}`}><L.icon className="h-6 w-6" /></span>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-extrabold">{o.label}</h2>
                    <p className="text-sm text-muted">{o.tagline}</p>
                  </div>
                </div>
                <ul className="mt-3 flex-1 space-y-1 text-sm">{o.includes.map((i) => <li key={i} className="flex items-start gap-2"><Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-500" />{i}</li>)}</ul>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
                  <span className="text-sm font-bold">{o.monthly !== null ? price(o.monthly) : <span className="text-muted">Prix sur demande</span>}</span>
                  {o.enabled ? <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/10 px-3 py-1.5 text-sm font-bold text-green-700 dark:text-green-400"><CheckCircle2 className="h-4 w-4" />Active</span>
                    : o.requestedAt ? <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-500/10 px-3 py-1.5 text-xs font-bold text-orange-700 dark:text-orange-300"><Clock className="h-4 w-4" />Demande envoyée le {formatDate(o.requestedAt, "Pacific/Tahiti")}</span>
                    : <Button onClick={() => unlock(o)}><Sparkles className="h-4 w-4" />Débloquer</Button>}
                </div>
              </article>
            );
          })}
        </div>
      )}
      <p className="mt-5 text-center text-xs text-muted">« Débloquer » envoie une demande à l&apos;équipe ManaResto : nous vous recontactons pour l&apos;activer.</p>
    </div>
  );
}
