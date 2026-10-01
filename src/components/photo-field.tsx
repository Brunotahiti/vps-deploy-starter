"use client";
/* eslint-disable @next/next/no-img-element -- aperçu d'une photo envoyée ou d'une URL libre */

import { useRef, useState } from "react";
import { Camera, Link2, Trash2, Loader2 } from "lucide-react";
import { ApiClientError } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { Input } from "@/components/ui/field";

const MAX_SIDE = 800; // réduction côté navigateur : légère à charger, nette sur tablette et dans la fiche du plat

/**
 * Réduit une image (photo de téléphone, plusieurs Mo) avant envoi : 800 px au plus, en WebP (≈ 40 à 80 Ko),
 * ou en JPEG si le navigateur ne sait pas produire du WebP (anciens Safari).
 */
async function shrink(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
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

/** Réduit puis envoie une photo ; retourne l'URL à enregistrer sur le produit. */
export async function uploadPhoto(file: File): Promise<string> {
  const { blob, width, height } = await shrink(file);
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

/** Photo d'un produit ou d'une formule : prise depuis l'appareil photo, la galerie, ou une URL. */
export function PhotoField({ value, onChange, label = "Photo" }: { value: string; onChange: (url: string) => void; label?: string }) {
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [urlMode, setUrlMode] = useState(false);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      onChange(await uploadPhoto(file));
      toast("Photo ajoutée", "success");
    } catch (e) { toast(e instanceof Error ? e.message : "Envoi impossible", "error"); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  };
  return (
    <div>
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">{label}</span>
      <div className="flex items-start gap-3">
        <div className="relative h-24 w-32 shrink-0 overflow-hidden rounded-xl surface-2">
          {value ? <img src={value} alt="" className="h-full w-full object-cover" /> : <span className="flex h-full w-full items-center justify-center text-muted"><Camera className="h-6 w-6" /></span>}
          {busy ? <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-white"><Loader2 className="h-6 w-6 animate-spin" /></span> : null}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => input.current?.click()} disabled={busy} className="touch inline-flex h-10 items-center gap-2 rounded-xl bg-brand px-3 text-sm font-bold text-white disabled:opacity-50"><Camera className="h-4 w-4" />{value ? "Changer la photo" : "Prendre ou choisir une photo"}</button>
            <button type="button" onClick={() => setUrlMode((v) => !v)} className="touch inline-flex h-10 items-center gap-2 rounded-xl surface-2 px-3 text-sm font-semibold"><Link2 className="h-4 w-4" />URL</button>
            {value ? <button type="button" onClick={() => onChange("")} className="touch inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-red-600"><Trash2 className="h-4 w-4" />Retirer</button> : null}
          </div>
          {urlMode ? <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://…/photo.jpg" inputMode="url" /> : <p className="text-xs text-muted">Depuis un téléphone : appareil photo ou galerie. La photo est réduite automatiquement (1000 px) et stockée avec vos données.</p>}
        </div>
      </div>
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
    </div>
  );
}
