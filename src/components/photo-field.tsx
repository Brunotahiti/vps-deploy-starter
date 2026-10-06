"use client";
/* eslint-disable @next/next/no-img-element -- aperçu d'une photo envoyée ou d'une URL libre */

import { useRef, useState } from "react";
import { Camera, Link2, Trash2, Loader2, ChevronLeft, ChevronRight, ImagePlus } from "lucide-react";
import { ApiClientError } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { Input } from "@/components/ui/field";

const MAX_SIDE = 800; // réduction côté navigateur : légère à charger, nette sur tablette et dans la fiche du plat

/**
 * Réduit une image (photo de téléphone, plusieurs Mo, JPEG, PNG, WebP, GIF, ou HEIC sur iPhone) avant envoi :
 * `maxSide` px au plus (800 par défaut), en WebP, ou en JPEG si le navigateur ne sait pas produire du WebP.
 */
async function shrink(file: File, maxSide = MAX_SIDE): Promise<{ blob: Blob; width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Cette image ne peut pas être lue sur cet appareil. Choisissez une photo JPEG ou PNG, ou prenez-la depuis la galerie du téléphone.")); i.src = url; });
    const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    c.getContext("2d")!.drawImage(img, 0, 0, w, h);
    const encode = (type: string, quality: number) => new Promise<Blob | null>((res) => c.toBlob(res, type, quality));
    let blob = await encode("image/webp", 0.8);
    if (!blob || blob.type !== "image/webp") blob = await encode("image/jpeg", 0.8);
    if (!blob) throw new Error("Impossible de traiter cette image");
    return { blob, width: w, height: h };
  } finally { URL.revokeObjectURL(url); }
}

/** Réduit puis envoie une photo ; retourne l'URL à enregistrer (plat, couverture, logo, photos du site). */
export async function uploadPhoto(file: File, maxSide = MAX_SIDE): Promise<string> {
  if (file.type && !file.type.startsWith("image/")) throw new Error("Ce fichier n'est pas une photo");
  const { blob, width, height } = await shrink(file, maxSide);
  const fd = new FormData(); fd.append("file", blob, blob.type === "image/webp" ? "photo.webp" : "photo.jpg"); fd.append("width", String(width)); fd.append("height", String(height));
  const r = await fetch("/api/uploads", { method: "POST", body: fd });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiClientError(r.status, json?.error?.code ?? "UPLOAD", json?.error?.message ?? "Envoi impossible");
  return json.data.url as string;
}

/** Vignette cliquable : prend ou change la photo d'un plat directement depuis une liste. */
export function QuickPhoto({ value, onUploaded, label }: { value: string | null; onUploaded: (url: string) => Promise<unknown>; label: string }) {
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try { await onUploaded(await uploadPhoto(file)); }
    catch (e) { toast(e instanceof Error ? e.message : "Envoi impossible", "error"); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  };
  return (
    <>
      <button type="button" onClick={(e) => { e.stopPropagation(); input.current?.click(); }} disabled={busy} aria-label={label} title={label}
        className={`group relative h-10 w-14 shrink-0 overflow-hidden rounded-lg ${value ? "" : "border border-dashed border-lagon-500/60 bg-lagon-500/5 text-lagon-600"}`}>
        {value ? <img src={value} alt="" className="h-full w-full object-cover" /> : <span className="flex h-full w-full items-center justify-center"><Camera className="h-4 w-4" /></span>}
        <span className={`absolute inset-0 flex items-center justify-center bg-black/45 text-white transition ${busy ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"}`}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}</span>
      </button>
      <input ref={input} type="file" accept="image/*" className="hidden" onClick={(e) => e.stopPropagation()} onChange={(e) => pick(e.target.files?.[0])} />
    </>
  );
}

/**
 * Photo d'un produit, d'une formule, ou du site (couverture, logo) : prise depuis l'appareil photo, la galerie,
 * ou une URL. `maxSide` règle la netteté (800 px pour un plat, plus pour une couverture) ; `shape` l'aperçu.
 */
export function PhotoField({ value, onChange, label = "Photo", maxSide = MAX_SIDE, shape = "photo", hint, testId }: { value: string; onChange: (url: string) => void; label?: string; maxSide?: number; shape?: "photo" | "wide" | "logo"; hint?: string; testId?: string }) {
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [urlMode, setUrlMode] = useState(false);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      onChange(await uploadPhoto(file, maxSide));
      toast("Photo ajoutée", "success");
    } catch (e) { toast(e instanceof Error ? e.message : "Envoi impossible", "error"); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  };
  return (
    <div data-testid={testId}>
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">{label}</span>
      <div className={`flex gap-3 ${shape === "wide" ? "flex-col" : "items-start"}`}>
        <div className={`relative shrink-0 overflow-hidden rounded-xl surface-2 ${shape === "wide" ? "aspect-[16/9] w-full max-w-md" : shape === "logo" ? "h-24 w-24" : "h-24 w-32"}`}>
          {value ? <img src={value} alt="" className={`h-full w-full ${shape === "logo" ? "object-contain p-1" : "object-cover"}`} /> : <span className="flex h-full w-full items-center justify-center text-muted"><Camera className="h-6 w-6" /></span>}
          {busy ? <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-white"><Loader2 className="h-6 w-6 animate-spin" /></span> : null}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => input.current?.click()} disabled={busy} className="touch inline-flex h-10 items-center gap-2 rounded-xl bg-brand px-3 text-sm font-bold text-white disabled:opacity-50"><Camera className="h-4 w-4" />{value ? "Changer la photo" : "Prendre ou choisir une photo"}</button>
            <button type="button" onClick={() => setUrlMode((v) => !v)} className="touch inline-flex h-10 items-center gap-2 rounded-xl surface-2 px-3 text-sm font-semibold"><Link2 className="h-4 w-4" />URL</button>
            {value ? <button type="button" onClick={() => onChange("")} className="touch inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-red-600"><Trash2 className="h-4 w-4" />Retirer</button> : null}
          </div>
          {urlMode ? <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://…/photo.jpg" inputMode="url" aria-label={`${label} : adresse web`} /> : <p className="text-xs text-muted">{hint ?? "Depuis un téléphone : appareil photo ou galerie. La photo est réduite automatiquement et stockée avec vos données."}</p>}
        </div>
      </div>
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
    </div>
  );
}

/**
 * Photos d'une galerie (site du restaurant) : plusieurs photos d'un coup depuis la galerie du téléphone ou
 * l'ordinateur, réduites puis envoyées une par une ; ordre modifiable, retrait d'un geste. Lien web possible.
 */
export function PhotoGallery({ value, onChange, max = 12, maxSide = 1600, label = "Photos" }: { value: string[]; onChange: (urls: string[]) => void; max?: number; maxSide?: number; label?: string }) {
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const room = max - value.length;
  const pick = async (files: FileList | null) => {
    const list = Array.from(files ?? []).slice(0, Math.max(0, room));
    if (input.current) input.current.value = "";
    if (!list.length) { if (files?.length) toast(`${max} photos au maximum : retirez-en une pour en ajouter`, "error"); return; }
    if ((files?.length ?? 0) > list.length) toast(`Seules les ${list.length} premières photos sont ajoutées (${max} au maximum)`, "error");
    let urls = [...value], failed = 0;
    setBusy({ done: 0, total: list.length });
    for (const [i, f] of list.entries()) {
      try { urls = [...urls, await uploadPhoto(f, maxSide)]; onChange(urls); }
      catch (e) { failed++; toast(e instanceof Error ? e.message : "Envoi impossible", "error"); }
      setBusy({ done: i + 1, total: list.length });
    }
    setBusy(null);
    if (list.length - failed > 0) toast(list.length - failed > 1 ? `${list.length - failed} photos ajoutées` : "Photo ajoutée", "success");
  };
  const move = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= value.length) return; const next = [...value]; [next[i], next[j]] = [next[j], next[i]]; onChange(next); };
  return (
    <div data-testid="photo-gallery">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">{label} <span className="normal-case tracking-normal">· {value.length}/{max}</span></span>
      {value.length ? (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {value.map((url, i) => (
            <li key={`${url}-${i}`} className="group relative aspect-square overflow-hidden rounded-xl surface-2" data-testid="gallery-photo">
              <img src={url} alt="" className="h-full w-full object-cover" />
              <div className="absolute inset-x-1 bottom-1 flex justify-between gap-1">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="touch grid h-8 w-8 place-items-center rounded-lg bg-black/55 text-white disabled:opacity-0" aria-label="Avancer la photo" title="Avancer"><ChevronLeft className="h-4 w-4" /></button>
                <button type="button" onClick={() => onChange(value.filter((_, k) => k !== i))} className="touch grid h-8 w-8 place-items-center rounded-lg bg-red-600/85 text-white" aria-label="Retirer la photo" title="Retirer"><Trash2 className="h-4 w-4" /></button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === value.length - 1} className="touch grid h-8 w-8 place-items-center rounded-lg bg-black/55 text-white disabled:opacity-0" aria-label="Reculer la photo" title="Reculer"><ChevronRight className="h-4 w-4" /></button>
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="rounded-xl surface-2 px-3 py-4 text-center text-xs text-muted">Aucune photo pour l&apos;instant : la salle, la vue, vos plats, l&apos;équipe…</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={() => input.current?.click()} disabled={!!busy || room <= 0} className="touch inline-flex h-10 items-center gap-2 rounded-xl bg-brand px-3 text-sm font-bold text-white disabled:opacity-50" data-testid="gallery-add">
          {busy ? <><Loader2 className="h-4 w-4 animate-spin" />Envoi {busy.done}/{busy.total}…</> : <><ImagePlus className="h-4 w-4" />Ajouter des photos</>}
        </button>
        <button type="button" onClick={() => setLink(link === null ? "" : null)} disabled={room <= 0} className="touch inline-flex h-10 items-center gap-2 rounded-xl surface-2 px-3 text-sm font-semibold disabled:opacity-50"><Link2 className="h-4 w-4" />Lien</button>
      </div>
      {link !== null ? (
        <div className="mt-2 flex gap-2">
          <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…/photo.jpg" inputMode="url" aria-label="Adresse web d'une photo" />
          <button type="button" onClick={() => { const u = link.trim(); if (u) { onChange([...value, u].slice(0, max)); setLink(null); } }} className="touch h-10 shrink-0 rounded-xl surface-2 px-3 text-sm font-bold">Ajouter</button>
        </div>
      ) : <p className="mt-1 text-xs text-muted">Choisissez plusieurs photos d&apos;un coup dans la galerie du téléphone ou sur l&apos;ordinateur ; elles sont réduites automatiquement. La première s&apos;affiche en premier.</p>}
      <input ref={input} type="file" accept="image/*" multiple className="hidden" onChange={(e) => pick(e.target.files)} data-testid="gallery-input" />
    </div>
  );
}
