"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Flame, PackageCheck, Plus, Printer, Snowflake, SprayCan, Tag, Thermometer, Trash2, Utensils } from "lucide-react";
import { api } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { useAction } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Badge, Empty, Spinner } from "@/components/ui/misc";
import { celebrate } from "@/lib/celebrate";
import { addDays, formatDate, formatDateTime, localDay } from "@/lib/dates";

type Kind = "FRIDGE" | "FREEZER" | "HOT" | "OTHER";
type Freq = "DAILY" | "WEEKLY" | "MONTHLY";
type Equipment = { id: string; name: string; kind: Kind; minTemp: number; maxTemp: number; isActive?: boolean };
type TodayEquipment = Equipment & { morning: boolean; evening: boolean; due: boolean; last: { value: number; compliant: boolean; takenAt: string; by: string | null } | null };
type TodayTask = { id: string; name: string; area: string | null; frequency: Freq; instructions: string | null; due: boolean; lastDoneAt: string | null; lastBy: string | null };
export type Trace = { id: string; kind: "RECEPTION" | "PREPARATION"; name: string; supplierName: string | null; lotNumber: string | null; quantity: string | null; temperature: number | null; compliant: boolean; issue: string | null; madeAt: string; useBy: string | null; expired: boolean; closedAt: string | null; closedReason: string | null; by: string | null };
export type Today = {
  day: string; slot: "MORNING" | "EVENING"; setupDone: boolean; equipment: TodayEquipment[]; cleaning: TodayTask[]; expiring: Trace[];
  counts: { readingsDue: number; cleaningDue: number; expired: number; expiringSoon: number; issuesToday: number };
};
type Reading = { id: string; equipment: string; min: number; max: number; value: number; compliant: boolean; correctiveAction: string | null; takenAt: string; by: string | null };
type Task = { id: string; name: string; area: string | null; frequency: Freq; instructions: string | null; isActive: boolean };

export const KIND: Record<Kind, { label: string; icon: typeof Snowflake; min: number; max: number }> = {
  FRIDGE: { label: "Réfrigérateur", icon: Thermometer, min: 0, max: 4 },
  FREEZER: { label: "Congélateur", icon: Snowflake, min: -30, max: -18 },
  HOT: { label: "Maintien au chaud", icon: Flame, min: 63, max: 100 },
  OTHER: { label: "Autre", icon: Thermometer, min: 0, max: 10 },
};
export const FREQ: Record<Freq, string> = { DAILY: "Chaque jour", WEEKLY: "Chaque semaine", MONTHLY: "Chaque mois" };
const deg = (n: number) => `${n.toLocaleString("fr-FR")} °C`;
/** « 3,5 », « -18 », « 3.5 » → nombre ; vide ou illisible → null */
export const parseDegrees = (s: string) => { const v = Number(s.trim().replace(",", ".").replace("−", "-")); return s.trim() === "" || !Number.isFinite(v) ? null : v; };
const ACTIONS = ["Porte refermée, contrôle refait dans 30 min", "Produits déplacés dans un autre frigo", "Thermostat réglé", "Produits jetés", "Technicien appelé"];

const invalidate = [["hygiene"]];

/** Relevé d'un équipement : la conformité s'affiche en direct ; hors limites, l'action corrective est demandée. */
function ReadingModal({ eq, onClose, onDone }: { eq: TodayEquipment | Equipment; onClose: () => void; onDone: () => void }) {
  const act = useAction();
  const [value, setValue] = useState("");
  const [action, setAction] = useState("");
  const [busy, setBusy] = useState(false);
  const v = parseDegrees(value);
  const out = v !== null && (v < eq.minTemp || v > eq.maxTemp);
  const save = async () => {
    if (v === null || (out && !action.trim())) return;
    setBusy(true);
    const r = await act(() => api.post("/api/hygiene/readings", { equipmentId: eq.id, value: v, correctiveAction: out ? action : null }), { success: out ? "Relevé enregistré avec son action corrective" : "Relevé enregistré", invalidate });
    setBusy(false);
    if (r) onDone();
  };
  return (
    <Modal open onClose={onClose} size="sm" title={eq.name} footer={<Button size="lg" className="w-full" onClick={save} loading={busy} disabled={v === null || (out && !action.trim())} data-testid="reading-save">Enregistrer le relevé</Button>}>
      <p className="mb-3 text-sm text-muted">Attendu : entre {deg(eq.minTemp)} et {deg(eq.maxTemp)}</p>
      <Field label="Température relevée (°C)">
        <Input autoFocus inputMode="decimal" placeholder="ex. 3,5" value={value} onChange={(e) => setValue(e.target.value)} className="h-16 text-center text-3xl font-extrabold" aria-label="Température relevée" data-testid="reading-value" />
      </Field>
      {v !== null ? (
        out ? <p className="mt-3 flex items-center gap-2 rounded-xl bg-red-500/10 px-3 py-2 text-sm font-bold text-red-700 dark:text-red-300" data-testid="reading-out"><AlertTriangle className="h-4 w-4 shrink-0" />Hors limites : que faites-vous ?</p>
          : <p className="mt-3 flex items-center gap-2 rounded-xl bg-green-500/10 px-3 py-2 text-sm font-bold text-green-700 dark:text-green-300"><CheckCircle2 className="h-4 w-4 shrink-0" />Conforme</p>
      ) : null}
      {out ? (
        <div className="mt-3">
          <div className="mb-2 flex flex-wrap gap-1.5">{ACTIONS.map((a) => <button key={a} type="button" onClick={() => setAction(a)} className={`touch rounded-full border px-3 py-1.5 text-xs font-semibold ${action === a ? "border-lagon-500 bg-lagon-500/10 text-lagon-700 dark:text-lagon-300" : "border-line"}`}>{a}</button>)}</div>
          <Textarea rows={2} placeholder="Action corrective" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Action corrective" data-testid="reading-action" />
        </div>
      ) : null}
    </Modal>
  );
}

/** Nouvelle réception (fournisseur, lot, température, DLC, conformité) ou préparation maison (DLC, étiquette). */
export function TraceModal({ kind, onClose }: { kind: Trace["kind"]; onClose: () => void }) {
  const act = useAction();
  const { timezone } = useSession();
  const today = localDay(new Date(), timezone);
  const [f, setF] = useState({ name: "", supplierName: "", lotNumber: "", quantity: "", temperature: "", useBy: kind === "PREPARATION" ? addDays(today, 3) : "", compliant: true, issue: "" });
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const ready = f.name.trim() && (f.compliant || f.issue.trim());
  const save = async () => {
    if (!ready) return;
    setBusy(true);
    const r = await act(() => api.post<{ id: string }>("/api/hygiene/trace", {
      kind, name: f.name, supplierName: f.supplierName || null, lotNumber: f.lotNumber || null, quantity: f.quantity || null,
      temperature: kind === "RECEPTION" ? parseDegrees(f.temperature) : null, useBy: f.useBy || null, compliant: f.compliant, issue: f.compliant ? null : f.issue,
    }), { success: kind === "RECEPTION" ? "Réception enregistrée" : "Préparation enregistrée", invalidate });
    setBusy(false);
    if (!r) return;
    // Préparation : l'étiquette s'ouvre, prête à imprimer
    if (kind === "PREPARATION") window.open(`/api/hygiene/trace/${r.id}/label`, "_blank", "noopener");
    onClose();
  };
  return (
    <Modal open onClose={onClose} size="sm" title={kind === "RECEPTION" ? "Réception de marchandise" : "Préparation maison"} footer={<Button size="lg" className="w-full" onClick={save} loading={busy} disabled={!ready} data-testid="trace-save">{kind === "PREPARATION" ? <><Tag className="h-4 w-4" />Enregistrer et imprimer l&apos;étiquette</> : "Enregistrer la réception"}</Button>}>
      <div className="grid gap-3">
        <Field label={kind === "RECEPTION" ? "Produit" : "Préparation"}><Input autoFocus value={f.name} onChange={(e) => set("name", e.target.value)} placeholder={kind === "RECEPTION" ? "ex. Thon rouge" : "ex. Sauce coco"} aria-label="Nom" /></Field>
        {kind === "RECEPTION" ? <Field label="Fournisseur"><Input value={f.supplierName} onChange={(e) => set("supplierName", e.target.value)} aria-label="Fournisseur" /></Field> : null}
        <div className="grid grid-cols-2 gap-3">
          <Field label="N° de lot"><Input value={f.lotNumber} onChange={(e) => set("lotNumber", e.target.value)} aria-label="Numéro de lot" /></Field>
          <Field label="Quantité"><Input value={f.quantity} onChange={(e) => set("quantity", e.target.value)} placeholder="ex. 5 kg" aria-label="Quantité" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {kind === "RECEPTION" ? <Field label="Température (°C)"><Input inputMode="decimal" value={f.temperature} onChange={(e) => set("temperature", e.target.value)} placeholder="ex. 2" aria-label="Température à réception" /></Field> : null}
          <Field label="À consommer avant le (DLC)"><Input type="date" min={kind === "PREPARATION" ? today : undefined} value={f.useBy} onChange={(e) => set("useBy", e.target.value)} aria-label="Date limite de consommation" /></Field>
        </div>
        {kind === "RECEPTION" ? (
          <div className="flex gap-2">
            <button type="button" onClick={() => set("compliant", true)} aria-pressed={f.compliant} className={`touch flex-1 rounded-xl border px-3 py-3 text-sm font-bold ${f.compliant ? "border-green-500 bg-green-500/10 text-green-700 dark:text-green-300" : "border-line"}`}>✓ Conforme</button>
            <button type="button" onClick={() => set("compliant", false)} aria-pressed={!f.compliant} className={`touch flex-1 rounded-xl border px-3 py-3 text-sm font-bold ${!f.compliant ? "border-red-500 bg-red-500/10 text-red-700 dark:text-red-300" : "border-line"}`}>✗ Non conforme</button>
          </div>
        ) : null}
        {!f.compliant ? <Textarea rows={2} value={f.issue} onChange={(e) => set("issue", e.target.value)} placeholder="Problème constaté et suite donnée (refusé, repris par le livreur…)" aria-label="Problème constaté" /> : null}
      </div>
    </Modal>
  );
}

function TraceActions({ r }: { r: Trace }) {
  const act = useAction();
  const close = (reason: "USED" | "DISCARDED") => act(() => api.post(`/api/hygiene/trace/${r.id}/close`, { reason }), { success: reason === "USED" ? "Marqué utilisé" : "Marqué jeté", invalidate });
  return (
    <div className="ml-auto flex shrink-0 gap-1.5">
      <a href={`/api/hygiene/trace/${r.id}/label`} target="_blank" rel="noopener" className="touch flex h-10 w-10 items-center justify-center rounded-xl border border-line hover:surface-2" title="Imprimer l'étiquette" aria-label={`Étiquette ${r.name}`}><Printer className="h-4 w-4" /></a>
      <Button size="sm" variant="secondary" onClick={() => close("USED")} aria-label={`${r.name} utilisé`}><Utensils className="h-4 w-4" />Utilisé</Button>
      <Button size="sm" variant="secondary" onClick={() => close("DISCARDED")} aria-label={`${r.name} jeté`}><Trash2 className="h-4 w-4" />Jeté</Button>
    </div>
  );
}

function TraceLine({ r, tz }: { r: Trace; tz: string }) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid="trace-line">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${r.kind === "RECEPTION" ? "bg-sky-500/10 text-sky-600" : "bg-amber-500/10 text-amber-600"}`}>{r.kind === "RECEPTION" ? <PackageCheck className="h-5 w-5" /> : <Utensils className="h-5 w-5" />}</span>
      <div className="min-w-0 flex-1 basis-48">
        <p className="font-bold">{r.name}{!r.compliant ? <span className="ml-2"><Badge color="red">Non conforme</Badge></span> : null}</p>
        <p className="text-xs text-muted">{r.kind === "RECEPTION" ? `Reçu ${formatDateTime(r.madeAt, tz)}${r.supplierName ? ` · ${r.supplierName}` : ""}` : `Préparé ${formatDateTime(r.madeAt, tz)}`}{r.lotNumber ? ` · lot ${r.lotNumber}` : ""}{r.temperature !== null ? ` · ${deg(r.temperature)}` : ""}{r.by ? ` · ${r.by}` : ""}</p>
        {r.useBy ? <p className={`text-xs ${r.closedAt ? "text-muted" : r.expired ? "font-bold text-red-600" : "font-bold text-orange-600"}`}>{r.expired ? "Date dépassée" : r.closedAt ? "DLC" : "À consommer avant le"} {formatDate(r.useBy, tz)}</p> : null}
        {r.issue ? <p className="text-xs text-red-600">{r.issue}</p> : null}
      </div>
      {r.closedAt ? <Badge color={r.closedReason === "USED" ? "green" : "gray"}>{r.closedReason === "USED" ? "Utilisé" : "Jeté / refusé"}</Badge> : <TraceActions r={r} />}
    </li>
  );
}

/** Aujourd'hui : relevés du moment, nettoyages à faire, dates limites proches. */
export function HygieneToday({ data }: { data: Today }) {
  const act = useAction();
  const { timezone } = useSession();
  const [reading, setReading] = useState<TodayEquipment | null>(null);
  const c = data.counts;
  const allDone = c.readingsDue + c.cleaningDue + c.expired === 0;
  const done = async (t: TodayTask) => {
    const r = await act(() => api.post(`/api/hygiene/cleaning/${t.id}/done`, {}), { success: `${t.name} : fait`, invalidate });
    if (r && c.cleaningDue === 1 && c.readingsDue === 0) celebrate();
  };
  const dueTasks = data.cleaning.filter((t) => t.due);
  const doneTasks = data.cleaning.filter((t) => !t.due);
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2" data-testid="hygiene-counts">
        {allDone ? <span className="inline-flex items-center gap-2 rounded-full bg-green-500/10 px-4 py-2 text-sm font-bold text-green-700 dark:text-green-300"><CheckCircle2 className="h-4 w-4" />Tout est à jour pour {data.slot === "MORNING" ? "ce matin" : "ce soir"}</span> : null}
        {c.readingsDue ? <Badge color="orange">{c.readingsDue} relevé{c.readingsDue > 1 ? "s" : ""} à faire</Badge> : null}
        {c.cleaningDue ? <Badge color="blue">{c.cleaningDue} nettoyage{c.cleaningDue > 1 ? "s" : ""} à faire</Badge> : null}
        {c.expired ? <Badge color="red">{c.expired} date{c.expired > 1 ? "s" : ""} dépassée{c.expired > 1 ? "s" : ""}</Badge> : null}
        {c.expiringSoon ? <Badge color="orange">{c.expiringSoon} à consommer vite</Badge> : null}
        {c.issuesToday ? <Badge color="red">{c.issuesToday} relevé{c.issuesToday > 1 ? "s" : ""} hors limites aujourd&apos;hui</Badge> : null}
      </div>

      <section>
        <h2 className="mb-2 flex items-center gap-2 text-base font-extrabold"><Thermometer className="h-5 w-5 text-lagon-600" />Températures · relevé du {data.slot === "MORNING" ? "matin" : "soir"}</h2>
        {data.equipment.length === 0 ? <p className="text-sm text-muted">Aucun équipement : ajoutez vos frigos et congélateurs dans Réglages.</p> : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.equipment.map((e) => {
              const K = KIND[e.kind];
              return (
                <article key={e.id} className={`card p-4 ${e.due ? "ring-2 ring-orange-400/50" : ""}`} data-testid="equipment-card">
                  <div className="flex items-start gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-teal-400 to-cyan-700 text-white"><K.icon className="h-5 w-5" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="font-bold">{e.name}</p>
                      <p className="text-xs text-muted">{deg(e.minTemp)} à {deg(e.maxTemp)}</p>
                    </div>
                    {e.last ? <span className={`text-xl font-extrabold ${e.last.compliant ? "text-green-600" : "text-red-600"}`} title={`Relevé ${formatDateTime(e.last.takenAt, timezone)}${e.last.by ? ` par ${e.last.by}` : ""}`}>{deg(e.last.value)}</span> : null}
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${e.morning ? "bg-green-500/10 text-green-700 dark:text-green-300" : "surface-2 text-muted"}`}>{e.morning ? "✓" : "○"} Matin</span>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${e.evening ? "bg-green-500/10 text-green-700 dark:text-green-300" : "surface-2 text-muted"}`}>{e.evening ? "✓" : "○"} Soir</span>
                    <Button size="sm" className="ml-auto" variant={e.due ? "primary" : "secondary"} onClick={() => setReading(e)} aria-label={`Relever ${e.name}`}><Thermometer className="h-4 w-4" />Relever</Button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 flex items-center gap-2 text-base font-extrabold"><SprayCan className="h-5 w-5 text-lagon-600" />Nettoyage</h2>
        {data.cleaning.length === 0 ? <p className="text-sm text-muted">Aucune tâche : créez votre plan de nettoyage dans l&apos;onglet Nettoyage.</p> : (
          <ul className="card divide-y divide-[var(--border)]">
            {dueTasks.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-4 py-3" data-testid="cleaning-due">
                <div className="min-w-0 flex-1"><p className="font-bold">{t.name}</p><p className="text-xs text-muted">{[t.area, FREQ[t.frequency]].filter(Boolean).join(" · ")}{t.instructions ? ` · ${t.instructions}` : ""}</p></div>
                <Button size="sm" onClick={() => done(t)} aria-label={`${t.name} fait`}><ClipboardCheck className="h-4 w-4" />Fait</Button>
              </li>
            ))}
            {doneTasks.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-4 py-2.5 opacity-70">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
                <div className="min-w-0 flex-1"><p className="font-semibold line-through decoration-1">{t.name}</p><p className="text-xs text-muted">{FREQ[t.frequency]} · fait {t.lastDoneAt ? formatDateTime(t.lastDoneAt, timezone) : ""}{t.lastBy ? ` par ${t.lastBy}` : ""}</p></div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.expiring.length ? (
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-base font-extrabold"><AlertTriangle className="h-5 w-5 text-orange-500" />Dates limites à surveiller</h2>
          <ul className="card divide-y divide-[var(--border)]">{data.expiring.map((r) => <TraceLine key={r.id} r={r} tz={timezone} />)}</ul>
        </section>
      ) : null}
      {reading ? <ReadingModal eq={reading} onClose={() => setReading(null)} onDone={() => setReading(null)} /> : null}
    </div>
  );
}

/** Historique des relevés (7 derniers jours). */
export function HygieneReadings() {
  const { timezone } = useSession();
  const q = useQuery({ queryKey: ["hygiene", "readings"], queryFn: () => api.get<Reading[]>("/api/hygiene/readings") });
  if (q.isLoading) return <Spinner />;
  if (!q.data?.length) return <Empty title="Aucun relevé ces 7 derniers jours" hint="Les relevés se font depuis l'onglet Aujourd'hui." />;
  return (
    <ul className="card divide-y divide-[var(--border)]">
      {q.data.map((r) => (
        <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
          <span className={`w-20 shrink-0 text-right text-lg font-extrabold ${r.compliant ? "text-green-600" : "text-red-600"}`}>{deg(r.value)}</span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{r.equipment} <span className="text-xs font-normal text-muted">({deg(r.min)} à {deg(r.max)})</span></p>
            <p className="text-xs text-muted">{formatDateTime(r.takenAt, timezone)}{r.by ? ` · ${r.by}` : ""}</p>
            {r.correctiveAction ? <p className="text-xs text-red-600">Action : {r.correctiveAction}</p> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Plan de nettoyage complet, modifiable par le responsable. */
export function HygieneCleaningPlan() {
  const act = useAction();
  const { can } = useSession();
  const manage = can("hygiene.manage");
  const q = useQuery({ queryKey: ["hygiene", "tasks"], queryFn: () => api.get<Task[]>("/api/hygiene/cleaning") });
  const [edit, setEdit] = useState<{ id?: string; name: string; area: string; frequency: Freq; instructions: string } | null>(null);
  const save = async () => {
    if (!edit?.name.trim()) return;
    const body = { name: edit.name, area: edit.area || null, frequency: edit.frequency, instructions: edit.instructions || null };
    const r = await act(() => (edit.id ? api.patch(`/api/hygiene/cleaning/${edit.id}`, body) : api.post("/api/hygiene/cleaning", body)), { success: "Plan de nettoyage mis à jour", invalidate });
    if (r) setEdit(null);
  };
  const remove = (t: Task) => act(() => api.delete(`/api/hygiene/cleaning/${t.id}`), { success: `« ${t.name} » retiré du plan`, invalidate });
  if (q.isLoading) return <Spinner />;
  return (
    <div className="grid gap-3">
      {manage ? <div><Button onClick={() => setEdit({ name: "", area: "", frequency: "DAILY", instructions: "" })}><Plus className="h-4 w-4" />Ajouter une tâche</Button></div> : null}
      {(["DAILY", "WEEKLY", "MONTHLY"] as Freq[]).map((fr) => {
        const list = q.data?.filter((t) => t.frequency === fr) ?? [];
        if (!list.length) return null;
        return (
          <section key={fr}>
            <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wider text-muted">{FREQ[fr]}</h3>
            <ul className="card divide-y divide-[var(--border)]">
              {list.map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1"><p className="font-semibold">{t.name}</p><p className="text-xs text-muted">{[t.area, t.instructions].filter(Boolean).join(" · ")}</p></div>
                  {manage ? <><Button size="sm" variant="ghost" onClick={() => setEdit({ id: t.id, name: t.name, area: t.area ?? "", frequency: t.frequency, instructions: t.instructions ?? "" })}>Modifier</Button><Button size="sm" variant="ghost" onClick={() => remove(t)} aria-label={`Retirer ${t.name}`}><Trash2 className="h-4 w-4" /></Button></> : null}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {!q.data?.length ? <Empty title="Plan de nettoyage vide" hint={manage ? "Ajoutez vos tâches, ou utilisez le plan type depuis l'onglet Aujourd'hui." : "Votre responsable peut créer le plan de nettoyage."} /> : null}
      {edit ? (
        <Modal open onClose={() => setEdit(null)} size="sm" title={edit.id ? "Modifier la tâche" : "Nouvelle tâche"} footer={<Button size="lg" className="w-full" onClick={save} disabled={!edit.name.trim()}>Enregistrer</Button>}>
          <div className="grid gap-3">
            <Field label="Tâche"><Input autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="ex. Hotte et filtres" aria-label="Tâche" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Zone"><Input value={edit.area} onChange={(e) => setEdit({ ...edit, area: e.target.value })} placeholder="Cuisine, salle…" aria-label="Zone" /></Field>
              <Field label="Fréquence"><Select value={edit.frequency} onChange={(e) => setEdit({ ...edit, frequency: e.target.value as Freq })} aria-label="Fréquence">{(Object.keys(FREQ) as Freq[]).map((k) => <option key={k} value={k}>{FREQ[k]}</option>)}</Select></Field>
            </div>
            <Field label="Consignes (produit, méthode)"><Textarea rows={2} value={edit.instructions} onChange={(e) => setEdit({ ...edit, instructions: e.target.value })} aria-label="Consignes" /></Field>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

/** Traçabilité : en cours (à surveiller) puis enregistrements récents. */
export function HygieneTrace() {
  const { timezone } = useSession();
  const [kind, setKind] = useState<Trace["kind"] | null>(null);
  const q = useQuery({ queryKey: ["hygiene", "trace"], queryFn: () => api.get<Trace[]>("/api/hygiene/trace") });
  const open = q.data?.filter((r) => !r.closedAt) ?? [];
  const closed = q.data?.filter((r) => r.closedAt) ?? [];
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-2 sm:flex">
        <Button size="lg" onClick={() => setKind("RECEPTION")} data-testid="new-reception"><PackageCheck className="h-5 w-5" />Réception</Button>
        <Button size="lg" variant="accent" onClick={() => setKind("PREPARATION")} data-testid="new-preparation"><Utensils className="h-5 w-5" />Préparation</Button>
      </div>
      {q.isLoading ? <Spinner /> : (
        <>
          <section>
            <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wider text-muted">En cours ({open.length})</h3>
            {open.length ? <ul className="card divide-y divide-[var(--border)]">{open.map((r) => <TraceLine key={r.id} r={r} tz={timezone} />)}</ul> : <p className="text-sm text-muted">Rien en cours : enregistrez vos livraisons et vos préparations maison.</p>}
          </section>
          {closed.length ? (
            <section>
              <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wider text-muted">Terminés ces 14 derniers jours</h3>
              <ul className="card divide-y divide-[var(--border)]">{closed.map((r) => <TraceLine key={r.id} r={r} tz={timezone} />)}</ul>
            </section>
          ) : null}
        </>
      )}
      {kind ? <TraceModal kind={kind} onClose={() => setKind(null)} /> : null}
    </div>
  );
}

/** Équipements suivis (réglages du responsable). */
export function HygieneEquipmentSettings() {
  const act = useAction();
  const q = useQuery({ queryKey: ["hygiene", "equipment"], queryFn: () => api.get<Equipment[]>("/api/hygiene/equipment") });
  const [edit, setEdit] = useState<{ id?: string; name: string; kind: Kind; minTemp: string; maxTemp: string } | null>(null);
  const min = edit ? parseDegrees(edit.minTemp) : null, max = edit ? parseDegrees(edit.maxTemp) : null;
  const valid = !!edit?.name.trim() && min !== null && max !== null && min <= max;
  const save = async () => {
    if (!edit || !valid) return;
    const body = { name: edit.name, kind: edit.kind, minTemp: min, maxTemp: max };
    const r = await act(() => (edit.id ? api.patch(`/api/hygiene/equipment/${edit.id}`, body) : api.post("/api/hygiene/equipment", body)), { success: "Équipement enregistré", invalidate });
    if (r) setEdit(null);
  };
  const remove = (e: Equipment) => act(() => api.delete(`/api/hygiene/equipment/${e.id}`), { success: `« ${e.name} » retiré (ses relevés restent au registre)`, invalidate });
  return (
    <div className="grid gap-3">
      <div><Button onClick={() => setEdit({ name: "", kind: "FRIDGE", minTemp: "0", maxTemp: "4" })}><Plus className="h-4 w-4" />Ajouter un équipement</Button></div>
      {q.isLoading ? <Spinner /> : q.data?.length ? (
        <ul className="card divide-y divide-[var(--border)]">
          {q.data.map((e) => { const K = KIND[e.kind]; return (
            <li key={e.id} className="flex items-center gap-3 px-4 py-2.5">
              <K.icon className="h-5 w-5 shrink-0 text-lagon-600" />
              <div className="min-w-0 flex-1"><p className="font-semibold">{e.name}</p><p className="text-xs text-muted">{K.label} · {deg(e.minTemp)} à {deg(e.maxTemp)}</p></div>
              <Button size="sm" variant="ghost" onClick={() => setEdit({ id: e.id, name: e.name, kind: e.kind, minTemp: String(e.minTemp).replace(".", ","), maxTemp: String(e.maxTemp).replace(".", ",") })}>Modifier</Button>
              <Button size="sm" variant="ghost" onClick={() => remove(e)} aria-label={`Retirer ${e.name}`}><Trash2 className="h-4 w-4" /></Button>
            </li>
          ); })}
        </ul>
      ) : <Empty title="Aucun équipement" hint="Ajoutez chaque réfrigérateur, congélateur ou meuble de maintien au chaud dont vous relevez la température." />}
      <p className="text-xs text-muted">Plages proposées : réfrigérateur 0 à 4 °C, congélateur −18 °C ou moins, maintien au chaud 63 °C ou plus. Adaptez-les à vos produits et à vos obligations.</p>
      {edit ? (
        <Modal open onClose={() => setEdit(null)} size="sm" title={edit.id ? "Modifier l'équipement" : "Nouvel équipement"} footer={<Button size="lg" className="w-full" onClick={save} disabled={!valid}>Enregistrer</Button>}>
          <div className="grid gap-3">
            <Field label="Nom"><Input autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="ex. Frigo boissons" aria-label="Nom de l'équipement" /></Field>
            <Field label="Type"><Select value={edit.kind} onChange={(e) => { const k = e.target.value as Kind; setEdit({ ...edit, kind: k, minTemp: String(KIND[k].min), maxTemp: String(KIND[k].max) }); }} aria-label="Type">{(Object.keys(KIND) as Kind[]).map((k) => <option key={k} value={k}>{KIND[k].label}</option>)}</Select></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Minimum (°C)"><Input inputMode="decimal" value={edit.minTemp} onChange={(e) => setEdit({ ...edit, minTemp: e.target.value })} aria-label="Température minimale" /></Field>
              <Field label="Maximum (°C)"><Input inputMode="decimal" value={edit.maxTemp} onChange={(e) => setEdit({ ...edit, maxTemp: e.target.value })} aria-label="Température maximale" /></Field>
            </div>
            {min !== null && max !== null && min > max ? <p className="text-sm font-semibold text-red-600">Le minimum doit être inférieur au maximum.</p> : null}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
