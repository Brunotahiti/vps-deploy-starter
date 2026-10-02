"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { api } from "@/lib/api-client";
import { useAction } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { Input, Toggle } from "@/components/ui/field";
import { Badge } from "@/components/ui/misc";
import { OPTIONS, OPTION_KEYS, SERVICES, SERVICE_KEYS, serviceRef, type OptionKey } from "@/lib/options";
import { formatDateTime } from "@/lib/dates";

const TZ = "Pacific/Tahiti";
type Pending = { id: string; organizationId: string; organizationName: string; option: string; kind: "option" | "service"; label: string; createdAt: string };

/** Console : demandes d'options en attente et prix mensuels (vide = « sur demande » pour le restaurateur). */
export function OptionsPanel({ onOpen }: { onOpen: (organizationId: string) => void }) {
  const act = useAction();
  const q = useQuery({ queryKey: ["platform-options"], queryFn: () => api.get<{ prices: Record<string, number | null>; requests: Pending[] }>("/api/platform/options") });
  const [draft, setDraft] = useState<Record<string, string>>({});
  if (!q.data) return null;
  const handle = (r: Pending, status: "DONE" | "DECLINED") => act(() => api.patch(`/api/platform/option-requests/${r.id}`, { status }), { success: status === "DONE" ? "Service marqué comme réalisé" : "Demande refusée", invalidate: [["platform-options"]] });
  const save = (k: string) => {
    const raw = (draft[k] ?? "").replace(/\s/g, "");
    const monthly = raw === "" ? null : Number(raw);
    if (monthly !== null && (!Number.isInteger(monthly) || monthly < 0)) return;
    act(() => api.put("/api/platform/options", { option: k, monthly }), { success: "Prix enregistré", invalidate: [["platform-options"]] });
  };
  return (
    <section className="card p-4" data-testid="platform-options">
      <h2 className="flex items-center gap-2 text-base font-extrabold"><Sparkles className="h-4 w-4 text-violet-500" />Options payantes</h2>
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-bold">Demandes en attente {q.data.requests.length ? <Badge color="orange">{q.data.requests.length}</Badge> : null}</h3>
          {q.data.requests.length === 0 ? <p className="text-xs text-muted">Aucune demande en attente.</p> : (
            <ul className="divide-y divide-[var(--border)] rounded-xl border border-line">
              {q.data.requests.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span><b>{r.organizationName}</b> · {r.label}<span className="block text-xs text-muted">{formatDateTime(r.createdAt, TZ)} (heure de Tahiti)</span></span>
                  <span className="flex shrink-0 gap-1.5">
                    {r.kind === "service" ? <><Button size="sm" onClick={() => handle(r, "DONE")}>Réalisé</Button><Button size="sm" variant="ghost" onClick={() => handle(r, "DECLINED")}>Refuser</Button></> : null}
                    <Button size="sm" variant="secondary" onClick={() => onOpen(r.organizationId)}>Ouvrir la fiche</Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="mb-2 text-sm font-bold">Prix par mois (F CFP)</h3>
          <ul className="space-y-2">
            {OPTION_KEYS.map((k) => (
              <li key={k} className="flex items-center gap-2 text-sm">
                <span className="w-36 shrink-0 font-semibold">{OPTIONS[k].label}</span>
                <Input inputMode="numeric" className="h-9" placeholder="sur demande" value={draft[k] ?? (q.data.prices[k]?.toString() ?? "")} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} aria-label={`Prix de l'option ${OPTIONS[k].label}`} />
                <Button size="sm" variant="secondary" onClick={() => save(k)}>OK</Button>
              </li>
            ))}
          </ul>
          <h3 className="mb-2 mt-4 text-sm font-bold">Services ponctuels : prix unique (F CFP)</h3>
          <ul className="space-y-2">
            {SERVICE_KEYS.map((k) => { const ref = serviceRef(k); return (
              <li key={k} className="flex items-center gap-2 text-sm">
                <span className="w-36 shrink-0 font-semibold">{SERVICES[k].label}</span>
                <Input inputMode="numeric" className="h-9" placeholder="sur demande" value={draft[ref] ?? (q.data.prices[ref]?.toString() ?? "")} onChange={(e) => setDraft({ ...draft, [ref]: e.target.value })} aria-label={`Prix du service ${SERVICES[k].label}`} />
                <Button size="sm" variant="secondary" onClick={() => save(ref)}>OK</Button>
              </li>
            ); })}
          </ul>
          <p className="mt-2 text-xs text-muted">Laissez vide pour afficher « sur demande » au restaurateur.</p>
        </div>
      </div>
    </section>
  );
}

/** Fiche d'un restaurant (console) : interrupteurs des options, demandes en attente signalées. */
export function OrgOptions({ id, options, requests }: { id: string; options: string[]; requests: { option: string; createdAt: string }[] }) {
  const qc = useQueryClient();
  const act = useAction();
  const toggle = (k: OptionKey, on: boolean) => {
    const next = on ? [...options, k] : options.filter((o) => o !== k);
    act(() => api.patch(`/api/platform/orgs/${id}/options`, { options: next }), { success: on ? `Option « ${OPTIONS[k].label} » activée` : `Option « ${OPTIONS[k].label} » retirée`, invalidate: [["platform-org", id], ["platform-options"]] }).then(() => qc.invalidateQueries({ queryKey: ["platform"] }));
  };
  return (
    <div data-testid="org-options">
      <h3 className="mb-2 text-sm font-extrabold">Options</h3>
      <ul className="grid gap-2 sm:grid-cols-2">
        {OPTION_KEYS.map((k) => {
          const req = requests.find((r) => r.option === k);
          return (
            <li key={k} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2 text-sm">
              <span className="min-w-0 flex-1"><b>{OPTIONS[k].label}</b>{req && !options.includes(k) ? <span className="block text-xs font-semibold text-orange-600">Demandée le {formatDateTime(req.createdAt, TZ)}</span> : <span className="block truncate text-xs text-muted">{OPTIONS[k].tagline}</span>}</span>
              <Toggle checked={options.includes(k)} onChange={(v) => toggle(k, v)} ariaLabel={`Option ${OPTIONS[k].label}`} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
