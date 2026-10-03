"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Download, ExternalLink, Mail, MessageCircle, Pencil, Share2, Smartphone } from "lucide-react";
import { api } from "@/lib/api-client";
import { useAction } from "@/components/admin/common";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { shareLabel, shareSlugError } from "@/lib/share";

type Availability = { slug: string; available: boolean; reason: string | null };

/**
 * « Partager mon site » : la belle adresse du restaurant (manaresto.com/<adresse>), l'aperçu affiché par WhatsApp ou
 * Facebook, les boutons de partage, le QR code à imprimer, et le choix de l'adresse.
 */
export function ShareSite({ name, slug, url, card, enabled, locked = false }: { name: string; slug: string; url: string; card: string; enabled: boolean; locked?: boolean }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const label = shareLabel(url);
  const text = `${name} : notre site, notre carte et la réservation en ligne 👉 ${url}`;
  const copy = () => navigator.clipboard?.writeText(url).then(() => { setCopied(true); toast("Adresse copiée : collez-la où vous voulez", "success"); setTimeout(() => setCopied(false), 2000); }, () => toast("Copie impossible : sélectionnez l'adresse", "error"));
  const nativeShare = () => navigator.share?.({ title: name, text: `${name} : notre site, notre carte et la réservation en ligne`, url }).catch(() => {});
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const btn = "touch inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold text-white transition hover:brightness-110";

  return (
    <section className="card mb-4 overflow-hidden" data-testid="share-site">
      <div className="grid grid-cols-1 gap-0 md:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 p-5">
          <p className="text-xs font-bold uppercase tracking-wide text-brand">Partager mon site</p>
          <h2 className="mt-1 text-lg font-extrabold">Votre adresse, facile à retenir</h2>
          <div className="mt-3 flex items-center gap-2 rounded-2xl border-2 border-lagon-500/40 bg-lagon-500/5 p-2 pl-4">
            <a href={url} target="_blank" rel="noopener" className="min-w-0 flex-1 truncate text-lg font-extrabold tracking-tight text-[var(--text)] sm:text-xl" data-testid="share-url">{label}</a>
            <button onClick={copy} className="touch inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-brand px-3 text-sm font-bold text-white shadow-glow" aria-label="Copier l'adresse">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}<span className="hidden sm:inline">{copied ? "Copiée" : "Copier"}</span></button>
          </div>
          {!enabled ? <p className="mt-2 text-xs font-semibold text-orange-600">Le site n&apos;est pas publié : activez « Publier le site du restaurant » ci-dessous avant de partager.</p> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener" className={`${btn} bg-[#25D366]`}><MessageCircle className="h-4 w-4" />WhatsApp</a>
            <a href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`} target="_blank" rel="noopener" className={`${btn} bg-[#1877F2]`}><span className="flex h-4 w-4 items-center justify-center rounded-sm bg-white text-[13px] font-black leading-none text-[#1877F2]" aria-hidden>f</span>Facebook</a>
            <a href={`sms:?&body=${encodeURIComponent(text)}`} className={`${btn} bg-slate-600`}><Smartphone className="h-4 w-4" />SMS</a>
            <a href={`mailto:?subject=${encodeURIComponent(name)}&body=${encodeURIComponent(text)}`} className={`${btn} bg-slate-500`}><Mail className="h-4 w-4" />E-mail</a>
            {canShare ? <button onClick={nativeShare} className={`${btn} bg-violet-600`}><Share2 className="h-4 w-4" />Autres…</button> : null}
          </div>
          <div className="mt-4 flex flex-wrap gap-2 text-sm">
            <a href="/api/digital/share/qr?download=1" className="touch inline-flex h-10 items-center gap-1.5 rounded-xl border border-line px-3 font-semibold hover:surface-2" data-testid="share-qr"><Download className="h-4 w-4" />QR code à imprimer</a>
            <a href={url} target="_blank" rel="noopener" className="touch inline-flex h-10 items-center gap-1.5 rounded-xl border border-line px-3 font-semibold hover:surface-2"><ExternalLink className="h-4 w-4" />Voir le site</a>
            {locked ? null : <button onClick={() => setEditing(true)} className="touch inline-flex h-10 items-center gap-1.5 rounded-xl border border-line px-3 font-semibold hover:surface-2" data-testid="share-edit"><Pencil className="h-4 w-4" />Changer l&apos;adresse</button>}
          </div>
        </div>
        <div className="min-w-0 border-t border-line surface-2 p-4 md:border-l md:border-t-0">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Aperçu sur WhatsApp et Facebook</p>
          <div className="overflow-hidden rounded-2xl bg-[var(--surface)] shadow-soft">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={card} alt={`Aperçu du lien de ${name}`} className="aspect-[1200/630] w-full object-cover" loading="lazy" data-testid="share-card" />
            <div className="p-3">
              <p className="truncate text-[11px] uppercase text-muted">{label.split("/")[0]}</p>
              <p className="truncate text-sm font-bold">{name}</p>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted">La photo vient de l&apos;image de couverture du site.</p>
        </div>
      </div>
      {editing ? <EditShareSlug current={slug} prefix={label.slice(0, label.length - slug.length)} onClose={() => setEditing(false)} /> : null}
    </section>
  );
}

function EditShareSlug({ current, prefix, onClose }: { current: string; prefix: string; onClose: () => void }) {
  const act = useAction();
  const [value, setValue] = useState(current);
  const [check, setCheck] = useState<Availability | null>(null);
  const slug = value.trim().toLowerCase();
  const localError = slug === current ? null : shareSlugError(slug);
  // Disponibilité vérifiée pendant la saisie (après une courte pause)
  useEffect(() => {
    if (slug === current || localError) return;
    const t = setTimeout(() => { api.get<Availability>(`/api/digital/share?slug=${encodeURIComponent(slug)}`).then(setCheck).catch(() => {}); }, 350);
    return () => clearTimeout(t);
  }, [slug, current, localError]);
  const status = slug === current ? null : localError ? { ok: false, text: localError } : check?.slug === slug ? { ok: check.available, text: check.available ? "Disponible" : check.reason ?? "Indisponible" } : null;
  const save = async () => {
    const r = await act(() => api.patch("/api/digital/share", { slug }), { success: "Nouvelle adresse enregistrée", invalidate: [["digital"], ["me"]] });
    if (r) onClose();
  };
  return (
    <Modal open onClose={onClose} size="sm" title="Changer l'adresse du site" footer={<Button size="lg" className="w-full" onClick={save} disabled={slug === current || !status?.ok} data-testid="share-save">Enregistrer</Button>}>
      <label className="block text-sm font-semibold">Adresse</label>
      <div className="mt-1 flex items-center overflow-hidden rounded-xl border border-line focus-within:ring-2 focus-within:ring-lagon-500/40">
        <span className="shrink-0 surface-2 px-3 py-2.5 text-sm text-muted">{prefix}</span>
        <input autoFocus value={value} onChange={(e) => setValue(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-{2,}/g, "-"))} maxLength={40} className="min-w-0 flex-1 bg-transparent px-2 py-2.5 text-sm font-bold outline-none" aria-label="Adresse du site" data-testid="share-input" />
      </div>
      {status ? <p className={`mt-2 text-sm font-semibold ${status.ok ? "text-green-600" : "text-red-600"}`} data-testid="share-status">{status.text}</p> : null}
      <p className="mt-3 text-xs text-muted">Lettres sans accent, chiffres et tirets, par exemple le nom du restaurant. Attention : l&apos;ancienne adresse ne fonctionnera plus (QR codes et liens déjà partagés).</p>
    </Modal>
  );
}
