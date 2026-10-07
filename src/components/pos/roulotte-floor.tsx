"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Check, ChefHat, ConciergeBell, ShoppingBag, Store } from "lucide-react";
import { api, ApiClientError } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { useToast } from "@/components/ui/toast";
import { Spinner } from "@/components/ui/misc";
import { PushBanner, PushToggle } from "@/components/push-toggle";
import { formatElapsed } from "@/lib/dates";
import type { TakeawayCard } from "@/server/services/takeaway";

type Board = { toAccept: TakeawayCard[]; preparing: TakeawayCard[]; ready: TakeawayCard[] };

const CHANNEL: Record<string, string> = { COUNTER: "Sur place", DINE_IN: "À table", TAKEAWAY: "À emporter", PICKUP: "En ligne", KIOSK: "Borne", DELIVERY: "Livraison" };
/** Où apporter : la table saisie à la commande ; à emporter / borne : le numéro d'appel. Sur place sans table : « Table ? », à renseigner. */
function whereOf(c: TakeawayCard) {
  const channel = CHANNEL[c.channel] ?? c.channel;
  if (c.tableLabel) return { big: `Table ${c.tableLabel}`, small: `${channel} · n° ${c.call}${c.name ? ` · ${c.name}` : ""}`, missing: false };
  if (c.channel === "COUNTER") return { big: "Table ?", small: `Sur place · n° ${c.call}${c.name ? ` · ${c.name}` : ""}`, missing: true };
  return { big: `N° ${c.call}`, small: `${channel}${c.name ? ` · ${c.name}` : ""}`, missing: false };
}

/** Table manquante (commande encaissée sans numéro) : saisie directe depuis la salle. */
function TableInput({ card, onSaved }: { card: TakeawayCard; onSaved: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const save = async (value: string) => {
    const label = value.trim();
    if (!label) return;
    setBusy(true);
    try { await api.patch(`/api/orders/${card.id}`, { tableLabel: label }); onSaved(); }
    catch (e) { toast(e instanceof ApiClientError ? e.message : "Erreur", "error"); }
    finally { setBusy(false); }
  };
  return (
    <label className="mt-1.5 flex h-10 w-40 items-center gap-2 rounded-xl bg-white/90 px-3 text-xs font-bold text-emerald-800">
      <span className="shrink-0">Table n°</span>
      <input inputMode="numeric" maxLength={6} placeholder="…" aria-label="Numéro de table" disabled={busy} data-testid="ready-table-input" onBlur={(e) => save(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} className="h-full w-full min-w-0 bg-transparent text-base font-extrabold text-emerald-900 outline-none placeholder:text-emerald-700/50" />
    </label>
  );
}

/** Bip court à l'arrivée d'un nouveau plat prêt (quand l'écran est ouvert). */
function chime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [[0, 880], [0.18, 1175]].forEach(([at, f]) => { const o = ctx.createOscillator(); const g = ctx.createGain(); o.frequency.value = f; g.gain.setValueAtTime(0.0001, ctx.currentTime + at); g.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.25); o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + at); o.stop(ctx.currentTime + at + 0.3); });
    setTimeout(() => ctx.close().catch(() => {}), 800);
  } catch { /* audio indisponible */ }
}

/**
 * Portail « Salle » du mode roulotte : les plats prêts en cuisine, avec la table où les apporter, et les commandes
 * en préparation. C'est ici qu'arrivent les « prêt en cuisine » (et la notification push ouvre cet écran).
 * Le serveur va chercher le plat, l'apporte à la table, puis appuie sur « Servi ».
 */
export function RoulotteFloor() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { me } = useSession();
  const board = useQuery({ queryKey: ["takeaway", "salle"], queryFn: () => api.get<Board>("/api/takeaway?tables=1"), refetchInterval: 15_000 });
  const [busy, setBusy] = useState<string | null>(null);
  // Les livraisons partent avec le livreur et les ardoises du bar se servent au bar : ni l'une ni l'autre n'est une table à servir
  const ready = (board.data?.ready ?? []).filter((c) => c.channel !== "DELIVERY" && !c.isTab);
  const preparing = (board.data?.preparing ?? []).filter((c) => c.channel !== "DELIVERY" && !c.isTab && c.itemsSent > 0);
  // Nouveau plat prêt pendant que l'écran est ouvert : bip et vibration (une fois)
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!board.data) return;
    const ids = new Set(ready.map((c) => c.id));
    if (seen.current && [...ids].some((id) => !seen.current!.has(id))) { chime(); try { navigator.vibrate?.([200, 100, 200]); } catch {} }
    seen.current = ids;
  }, [board.data, ready]);

  const served = async (c: TakeawayCard) => {
    setBusy(c.id);
    try { await api.post(`/api/orders/${c.id}/takeaway`, { step: "picked_up" }); toast(`${whereOf(c).big} : servi ✓`, "success"); qc.invalidateQueries({ queryKey: ["takeaway"] }); qc.invalidateQueries({ queryKey: ["orders"] }); }
    catch (e) { toast(e instanceof ApiClientError ? e.message : "Erreur", "error"); }
    finally { setBusy(null); }
  };
  const first = (me?.user?.displayName || me?.user?.firstName || "").split(" ")[0];

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-6 pt-4" data-testid="roulotte-floor">
      <div className="mb-3 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-2xl font-extrabold"><ConciergeBell className="h-6 w-6 text-brand" />Salle</p>
          <p className="text-sm text-muted">{first ? `${first}, ` : ""}{ready.length ? `${ready.length} plat${ready.length > 1 ? "s" : ""} prêt${ready.length > 1 ? "s" : ""} à apporter` : "les plats prêts en cuisine s'affichent ici, avec leur table"}</p>
        </div>
        <PushToggle compact />
      </div>
      <PushBanner className="mb-4" />

      {board.isLoading ? <div className="flex justify-center py-16"><Spinner /></div> : null}

      {ready.length ? (
        <section className="mb-5 rounded-3xl bg-gradient-to-br from-emerald-500 to-green-600 p-4 text-white shadow-lift" data-testid="ready-list">
          <p className="mb-3 flex items-center gap-2 text-lg font-extrabold"><BellRing className="h-5 w-5 animate-bounce" />Prêt en cuisine : à apporter</p>
          <div className="space-y-2">
            {ready.map((c) => {
              const w = whereOf(c);
              return (
                <div key={c.id} className="flex items-center gap-3 rounded-2xl bg-white/20 p-3 backdrop-blur" data-testid="ready-card">
                  <div className="min-w-0 flex-1">
                    <p className={`text-2xl font-extrabold leading-tight ${w.missing ? "text-amber-100" : ""}`}>{w.big}</p>
                    <p className="truncate text-xs opacity-90">{w.small}</p>
                    {c.itemNames?.length ? <p className="mt-1 truncate text-sm font-semibold">{c.itemNames.join(", ")}</p> : null}
                    {w.missing ? <TableInput card={c} onSaved={() => qc.invalidateQueries({ queryKey: ["takeaway"] })} /> : null}
                  </div>
                  <button onClick={() => served(c)} disabled={busy === c.id} className="touch flex h-14 shrink-0 items-center gap-1.5 rounded-xl bg-white px-4 text-sm font-extrabold text-emerald-700 shadow-soft active:scale-95 disabled:opacity-60" data-testid="ready-served"><Check className="h-5 w-5" />{c.channel === "TAKEAWAY" ? "Remis" : "Servi"}</button>
                </div>
              );
            })}
          </div>
        </section>
      ) : !board.isLoading ? (
        <div className="mb-5 rounded-3xl border border-dashed border-line p-6 text-center">
          <ChefHat className="mx-auto h-8 w-8 text-muted" />
          <p className="mt-2 font-bold">Rien à apporter pour l&apos;instant</p>
          <p className="text-sm text-muted">Dès que la cuisine marque un plat prêt, il apparaît ici avec sa table, et vous recevez la notification.</p>
        </div>
      ) : null}

      {preparing.length ? (
        <section>
          <p className="mb-2 flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-muted"><ChefHat className="h-4 w-4" />En préparation ({preparing.length})</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {preparing.map((c) => {
              const w = whereOf(c);
              return (
                <div key={c.id} className="card p-3" data-testid="preparing-card">
                  <p className="flex items-center gap-1.5 text-lg font-extrabold leading-tight">{c.channel === "TAKEAWAY" ? <ShoppingBag className="h-4 w-4 text-muted" /> : <Store className="h-4 w-4 text-muted" />}{w.big}</p>
                  <p className="truncate text-xs text-muted">{w.small}</p>
                  <p className="mt-1 text-xs font-semibold text-muted">{c.itemsReady}/{c.items} prêt{c.itemsReady > 1 ? "s" : ""} · {formatElapsed(c.openedAt)}</p>
                  {w.missing ? <p className="mt-1 text-[11px] font-bold text-amber-600">Table à renseigner</p> : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
