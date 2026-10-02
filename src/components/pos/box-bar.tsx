"use client";

import { useEffect, useState } from "react";
import { HardDrive, RefreshCw } from "lucide-react";

type BoxStatus = { mode: "relay" | "local"; pending: number; replaying: boolean };

/**
 * Bandeau du boîtier de secours : visible seulement quand la tablette passe par un boîtier (adresse /__box/status)
 * et qu'il a pris le relais pendant une coupure, ou qu'il renvoie les saisies au cloud au retour d'internet.
 */
export function BoxBar() {
  const [status, setStatus] = useState<BoxStatus | null>(null);
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let next = 10_000;
      try {
        const r = await fetch("/__box/status", { cache: "no-store" });
        const s = r.ok && r.headers.get("content-type")?.includes("application/json") ? ((await r.json()) as BoxStatus) : null;
        if (!stop) setStatus(s?.mode ? s : null);
        if (!s?.mode) next = 300_000; // pas de boîtier devant cette tablette : on revérifie rarement
      } catch {
        if (!stop) setStatus(null);
      }
      if (!stop) timer = setTimeout(poll, next);
    };
    poll();
    return () => { stop = true; clearTimeout(timer); };
  }, []);

  if (!status) return null;
  if (status.mode === "local") {
    return (
      <div className="flex items-center justify-center gap-2 bg-amber-500 px-3 py-1.5 text-center text-xs font-bold text-white" data-testid="box-bar" data-mode="local">
        <HardDrive className="h-4 w-4 shrink-0" />
        <span>Internet coupé : le boîtier de secours a pris le relais, tout continue normalement.{status.pending ? ` ${status.pending} saisie${status.pending > 1 ? "s" : ""} partira${status.pending > 1 ? "ont" : ""} au retour d'internet.` : ""}</span>
      </div>
    );
  }
  if (status.pending > 0 || status.replaying) {
    return (
      <div className="flex items-center justify-center gap-2 bg-lagon-600 px-3 py-1.5 text-center text-xs font-bold text-white" data-testid="box-bar" data-mode="replay">
        <RefreshCw className="h-4 w-4 shrink-0 animate-spin" />
        <span>Internet revenu : envoi des saisies au cloud{status.pending ? ` (${status.pending})` : ""}…</span>
      </div>
    );
  }
  return null;
}
