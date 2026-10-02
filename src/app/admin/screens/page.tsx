"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, ExternalLink, Plus, QrCode, RefreshCw, Trash2, Tv } from "lucide-react";
import { api } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { PageHeader, useAction } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Select, Toggle } from "@/components/ui/field";
import { Badge, Empty, Spinner } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";

type Screen = { id: string; name: string; token: string; categoryIds: string[]; showPrices: boolean; hideSoldOut: boolean; showImages: boolean; rotateSeconds: number; theme: "lagoon" | "night" | "light"; headline: string | null; headlineText: string | null; headlinePrice: number | null; isActive: boolean; lastSeenAt: string | null };
type Category = { id: string; name: string };
const THEMES = { lagoon: "Lagon (turquoise)", night: "Nuit (sombre)", light: "Clair" };
type Form = Omit<Screen, "id" | "token" | "lastSeenAt" | "headlinePrice"> & { id?: string; headlinePrice: string };
const blank: Form = { name: "", categoryIds: [], showPrices: true, hideSoldOut: false, showImages: true, rotateSeconds: 12, theme: "lagoon", headline: "", headlineText: "", headlinePrice: "", isActive: true };

function seen(at: string | null) {
  if (!at) return { label: "Jamais affiché", color: "gray" as const };
  const min = Math.round((Date.now() - new Date(at).getTime()) / 60000);
  return min <= 2 ? { label: "Allumé", color: "green" as const } : { label: `Vu il y a ${min < 60 ? `${min} min` : `${Math.round(min / 60)} h`}`, color: "orange" as const };
}

/** Écrans en salle (option) : la carte sur une télévision, toujours à jour. */
export default function ScreensPage() {
  const act = useAction();
  const { toast } = useToast();
  const { can, hasOption } = useSession();
  const allowed = hasOption("screens") && can("settings.manage");
  const q = useQuery({ queryKey: ["screens"], queryFn: () => api.get<Screen[]>("/api/screens"), enabled: allowed, refetchInterval: 60_000 });
  const cats = useQuery({ queryKey: ["catalog", "categories"], queryFn: () => api.get<Category[]>("/api/categories"), enabled: allowed });
  const [edit, setEdit] = useState<Form | null>(null);
  const [qr, setQr] = useState<Screen | null>(null);
  if (!allowed) return <Empty title="Écrans en salle" hint="Cette option se débloque dans Gestion → Options." />;
  const url = (s: Screen) => `${window.location.origin}/ecran/${s.token}`;
  const save = async () => {
    if (!edit?.name.trim()) return;
    const price = edit.headlinePrice.replace(/\s/g, "");
    const body = { name: edit.name, categoryIds: edit.categoryIds, showPrices: edit.showPrices, hideSoldOut: edit.hideSoldOut, showImages: edit.showImages, rotateSeconds: edit.rotateSeconds, theme: edit.theme, headline: edit.headline || null, headlineText: edit.headlineText || null, headlinePrice: price ? Number(price) : null, isActive: edit.isActive };
    const r = await act(() => (edit.id ? api.patch(`/api/screens/${edit.id}`, body) : api.post("/api/screens", body)), { success: "Écran enregistré", invalidate: [["screens"]] });
    if (r) setEdit(null);
  };
  const copy = async (s: Screen) => { try { await navigator.clipboard.writeText(url(s)); toast("Adresse copiée", "success"); } catch { toast(url(s)); } };
  const regen = (s: Screen) => confirm("Nouvelle adresse : l'écran actuel cessera d'afficher la carte. Continuer ?") && act(() => api.post(`/api/screens/${s.id}/token`), { success: "Nouvelle adresse créée", invalidate: [["screens"]] });
  const remove = (s: Screen) => confirm(`Supprimer l'écran « ${s.name} » ?`) && act(() => api.delete(`/api/screens/${s.id}`), { success: "Écran supprimé", invalidate: [["screens"]] });
  const toggleCat = (id: string) => edit && setEdit({ ...edit, categoryIds: edit.categoryIds.includes(id) ? edit.categoryIds.filter((c) => c !== id) : [...edit.categoryIds, id] });

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Écrans en salle" subtitle="Votre carte sur une télévision ou une tablette : prix et plats épuisés toujours à jour, défilement automatique."
        action={<Button onClick={() => setEdit({ ...blank })} data-testid="screen-new"><Plus className="h-4 w-4" />Nouvel écran</Button>} />
      {q.isLoading ? <Spinner /> : !q.data?.length ? (
        <Empty title="Aucun écran" hint="Créez un écran, puis ouvrez son adresse sur le navigateur de la télévision (ou scannez son QR code avec une tablette)." action={<Button onClick={() => setEdit({ ...blank, name: "Comptoir" })}><Plus className="h-4 w-4" />Créer un écran</Button>} />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {q.data.map((s) => { const st = seen(s.lastSeenAt); return (
            <li key={s.id} className={`card p-4 ${s.isActive ? "" : "opacity-60"}`} data-testid="screen-row">
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-400 to-sky-600 text-white"><Tv className="h-5 w-5" /></span>
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{s.name} <span className="ml-1"><Badge color={st.color}>{s.isActive ? st.label : "Désactivé"}</Badge></span></p>
                  <p className="text-xs text-muted">{s.categoryIds.length ? `${s.categoryIds.length} catégorie${s.categoryIds.length > 1 ? "s" : ""}` : "Toute la carte"} · {THEMES[s.theme]} · {s.rotateSeconds} s par page{s.headline ? ` · ${s.headline}` : ""}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <a href={`/ecran/${s.token}`} target="_blank" rel="noopener" className="touch inline-flex h-9 items-center gap-1.5 rounded-xl border border-line px-3 text-sm font-semibold hover:surface-2" data-testid="screen-open"><ExternalLink className="h-4 w-4" />Aperçu</a>
                <Button size="sm" variant="secondary" onClick={() => copy(s)}><Copy className="h-4 w-4" />Adresse</Button>
                <Button size="sm" variant="secondary" onClick={() => setQr(s)}><QrCode className="h-4 w-4" />QR code</Button>
                <Button size="sm" variant="ghost" onClick={() => setEdit({ ...s, headline: s.headline ?? "", headlineText: s.headlineText ?? "", headlinePrice: s.headlinePrice != null ? String(s.headlinePrice) : "" })}>Modifier</Button>
                <Button size="sm" variant="ghost" onClick={() => regen(s)} aria-label={`Nouvelle adresse pour ${s.name}`}><RefreshCw className="h-4 w-4" /></Button>
                <Button size="sm" variant="ghost" onClick={() => remove(s)} aria-label={`Supprimer ${s.name}`}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </li>
          ); })}
        </ul>
      )}
      {edit ? (
        <Modal open onClose={() => setEdit(null)} size="lg" title={edit.id ? "Modifier l'écran" : "Nouvel écran"} footer={<Button size="lg" className="w-full" onClick={save} disabled={!edit.name.trim()} data-testid="screen-save">Enregistrer</Button>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nom"><Input autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Comptoir, terrasse, vitrine…" aria-label="Nom de l'écran" /></Field>
            <Field label="Style"><Select value={edit.theme} onChange={(e) => setEdit({ ...edit, theme: e.target.value as Form["theme"] })} aria-label="Style">{Object.entries(THEMES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
            <Field label="Catégories affichées" className="sm:col-span-2" hint="Aucune cochée : toute la carte">
              <div className="flex flex-wrap gap-1.5">{(cats.data ?? []).map((c) => <button key={c.id} type="button" onClick={() => toggleCat(c.id)} aria-pressed={edit.categoryIds.includes(c.id)} className={`touch rounded-full border px-3 py-1.5 text-sm font-semibold ${edit.categoryIds.includes(c.id) ? "border-lagon-500 bg-lagon-500/10 text-lagon-700 dark:text-lagon-300" : "border-line"}`}>{c.name}</button>)}</div>
            </Field>
            <Field label="Mise en avant (titre)"><Input value={edit.headline ?? ""} onChange={(e) => setEdit({ ...edit, headline: e.target.value })} placeholder="Plat du jour, Happy hour…" aria-label="Titre de la mise en avant" /></Field>
            <Field label="Prix mis en avant (F CFP)"><Input inputMode="numeric" value={edit.headlinePrice} onChange={(e) => setEdit({ ...edit, headlinePrice: e.target.value })} aria-label="Prix mis en avant" /></Field>
            <Field label="Texte mis en avant" className="sm:col-span-2"><Input value={edit.headlineText ?? ""} onChange={(e) => setEdit({ ...edit, headlineText: e.target.value })} placeholder="ex. Poisson cru au lait de coco, riz" aria-label="Texte mis en avant" /></Field>
            <Field label="Secondes par page"><Input type="number" min={5} max={120} value={edit.rotateSeconds} onChange={(e) => setEdit({ ...edit, rotateSeconds: Math.min(120, Math.max(5, Number(e.target.value) || 12)) })} aria-label="Secondes par page" /></Field>
            <div className="grid gap-2 pt-1">
              <Toggle checked={edit.showPrices} onChange={(v) => setEdit({ ...edit, showPrices: v })} label="Afficher les prix" />
              <Toggle checked={edit.showImages} onChange={(v) => setEdit({ ...edit, showImages: v })} label="Afficher les photos" />
              <Toggle checked={edit.hideSoldOut} onChange={(v) => setEdit({ ...edit, hideSoldOut: v })} label="Masquer les plats épuisés (sinon : « Épuisé »)" />
              {edit.id ? <Toggle checked={edit.isActive} onChange={(v) => setEdit({ ...edit, isActive: v })} label="Écran actif" /> : null}
            </div>
          </div>
        </Modal>
      ) : null}
      {qr ? (
        <Modal open onClose={() => setQr(null)} size="sm" title={`Écran « ${qr.name} »`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- image générée par l'API (QR code) */}
          <img src={`/api/screens/${qr.id}/qr`} alt={`QR code de l'écran ${qr.name}`} className="mx-auto h-64 w-64 rounded-xl" />
          <p className="mt-3 text-center text-sm text-muted">Scannez avec la tablette, ou tapez l&apos;adresse dans le navigateur de la télévision :</p>
          <p className="mt-1 break-all text-center font-mono text-xs">{url(qr)}</p>
        </Modal>
      ) : null}
    </div>
  );
}
