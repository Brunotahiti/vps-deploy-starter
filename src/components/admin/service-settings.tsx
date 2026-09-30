"use client";

import { useState } from "react";
import { Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Toggle } from "@/components/ui/field";
import { Card, Spinner } from "@/components/ui/misc";
import { useAction, useList } from "@/components/admin/common";
import type { ServiceSettings } from "@/server/services/service-tracking";

type Settings = ServiceSettings & { defaults: { steps: ServiceSettings["steps"]; delays: ServiceSettings["delays"] } };
const DELAY_LABEL: Record<keyof ServiceSettings["delays"], string> = { welcome: "Accueil après installation", drinksCheck: "Vérification après les boissons", foodCheck: "Vérification après les plats", dessertOffer: "Proposer le dessert après la vérification", dessertCheck: "Vérification après le dessert", bill: "Proposer l'addition après le dessert", late: "Considérer un rappel en retard après" };
const slug = (label: string) => label.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "etape";

/** Réglages du suivi de service : activation, délais, alertes, attribution et étapes du parcours. */
export function ServiceSettingsCard() {
  const act = useAction();
  const q = useList<Settings>(["service", "settings"], "/api/service/settings");
  const [draft, setDraft] = useState<ServiceSettings | null>(null);
  const s = draft ?? (q.data ? { enabled: q.data.enabled, assignTo: q.data.assignTo, sound: q.data.sound, vibrate: q.data.vibrate, delays: q.data.delays, steps: q.data.steps } : null);
  if (!s) return <Card title="Suivi de service"><Spinner /></Card>;
  const set = (patch: Partial<ServiceSettings>) => setDraft({ ...s, ...patch });
  const setStep = (i: number, label: string) => set({ steps: s.steps.map((st, j) => (j === i ? { ...st, label } : st)) });
  const move = (i: number, dir: -1 | 1) => { const arr = [...s.steps]; const j = i + dir; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; set({ steps: arr }); };
  const save = () => act(() => api.patch("/api/service/settings", s), { success: "Suivi de service enregistré", invalidate: [["service"]] }).then((r) => r && setDraft(null));
  return (
    <Card title="Suivi de service" action={<Button size="sm" onClick={save} disabled={!draft}>Enregistrer</Button>}>
      <div className="space-y-4">
        <p className="text-sm text-muted">Aide les serveurs à repasser aux tables : parcours d&apos;étapes par table, rappels « à apporter », prise de commande, vérification, dessert et addition, avec le panneau « À faire maintenant » en caisse.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Toggle checked={s.enabled} onChange={(v) => set({ enabled: v })} label="Activer le suivi de service" />
          <Field label="Rappels visibles par"><Select value={s.assignTo} onChange={(e) => set({ assignTo: e.target.value as "SERVER" | "TEAM" })}><option value="SERVER">Le serveur de la table (et les rappels sans serveur par tous)</option><option value="TEAM">Toute l&apos;équipe</option></Select></Field>
          <Toggle checked={s.sound} onChange={(v) => set({ sound: v })} label="Son à l'arrivée d'un nouveau rappel (une seule fois par rappel)" />
          <Toggle checked={s.vibrate} onChange={(v) => set({ vibrate: v })} label="Vibration sur les tablettes et téléphones compatibles" />
        </div>
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Délais entre les étapes (minutes)</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(Object.keys(DELAY_LABEL) as (keyof ServiceSettings["delays"])[]).map((k) => <Field key={k} label={DELAY_LABEL[k]}><Input type="number" min={k === "late" ? 1 : 0} max={120} value={s.delays[k]} onChange={(e) => set({ delays: { ...s.delays, [k]: Number(e.target.value) } })} /></Field>)}
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Étapes du parcours de service</p>
          <ol className="space-y-1.5">
            {s.steps.map((st, i) => (
              <li key={st.key} className="flex items-center gap-2">
                <span className="w-6 text-center text-xs font-bold text-muted">{i + 1}</span>
                <Input value={st.label} onChange={(e) => setStep(i, e.target.value)} className="flex-1" />
                <button onClick={() => move(i, -1)} className="touch flex h-9 w-9 items-center justify-center rounded-lg surface-2" aria-label="Monter"><ArrowUp className="h-4 w-4" /></button>
                <button onClick={() => move(i, 1)} className="touch flex h-9 w-9 items-center justify-center rounded-lg surface-2" aria-label="Descendre"><ArrowDown className="h-4 w-4" /></button>
                <button onClick={() => s.steps.length > 1 && set({ steps: s.steps.filter((_, j) => j !== i) })} className="touch flex h-9 w-9 items-center justify-center rounded-lg text-red-600 hover:surface-2" aria-label="Supprimer"><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
          </ol>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => { const label = window.prompt("Libellé de la nouvelle étape"); if (label) set({ steps: [...s.steps, { key: `${slug(label)}_${Date.now().toString(36).slice(-3)}`, label }] }); }}><Plus className="h-4 w-4" /> Ajouter une étape</Button>
            <Button variant="ghost" size="sm" onClick={() => q.data && set({ steps: q.data.defaults.steps, delays: q.data.defaults.delays })}>Rétablir le parcours par défaut</Button>
          </div>
          <p className="mt-2 text-[11px] text-muted">Les étapes clés (accueil, commandes boissons / plats / dessert, vérifications, addition) sont reconnues par leur identifiant : elles se cochent automatiquement au fil du service. Les étapes ajoutées sont cochées à la main.</p>
        </div>
      </div>
    </Card>
  );
}
