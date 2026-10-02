"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Bell, Check, ExternalLink, Phone, Plus, Undo2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { formatMoney } from "@/lib/money";
import { formatTime } from "@/lib/dates";
import { useSession } from "@/hooks/use-session";
import { useAction } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/misc";
import type { TakeawayCard } from "@/server/services/takeaway";

type Board = { toAccept: TakeawayCard[]; preparing: TakeawayCard[]; ready: TakeawayCard[] };
type Col = "toAccept" | "preparing" | "ready";

const CHANNEL: Record<string, { emoji: string; label: string }> = {
  COUNTER: { emoji: "🧍", label: "Comptoir" },
  TAKEAWAY: { emoji: "🛍️", label: "À emporter" },
  PICKUP: { emoji: "🌐", label: "En ligne" },
  KIOSK: { emoji: "📱", label: "Borne" },
  DELIVERY: { emoji: "🛵", label: "Livraison" },
};
const COLS: { key: Col; title: string; emoji: string; tone: string; empty: string }[] = [
  { key: "toAccept", title: "À accepter", emoji: "📥", tone: "from-sky-500 to-blue-600", empty: "" },
  { key: "preparing", title: "En préparation", emoji: "👨‍🍳", tone: "from-orange-400 to-amber-500", empty: "Rien en préparation" },
  { key: "ready", title: "Prêtes à remettre", emoji: "🛎️", tone: "from-emerald-500 to-teal-600", empty: "Aucune commande qui attend son client" },
];

/** Minutes entre maintenant et une heure (positif : à venir). */
const minutesTo = (iso: string, now: number) => Math.round((new Date(iso).getTime() - now) / 60000);

export function TakeawayBoard() {
  const { timezone: tz, currency } = useSession();
  const q = useQuery({ queryKey: ["takeaway"], queryFn: () => api.get<Board>("/api/takeaway"), refetchInterval: 15_000 });
  const [creating, setCreating] = useState(false);
  const [mobileCol, setMobileCol] = useState<Col>("preparing");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);

  const b = q.data;
  const cols = COLS.filter((c) => c.key !== "toAccept" || (b?.toAccept.length ?? 0) > 0);
  const activeCol = cols.some((c) => c.key === mobileCol) ? mobileCol : "preparing";

  return (
    <div className="flex h-full flex-col" data-testid="takeaway-board">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-3 sm:px-5">
        <div className="mr-auto">
          <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">À emporter</h1>
          <p className="text-xs text-muted">Comptoir, à emporter, en ligne et borne · du plus pressé au moins pressé</p>
        </div>
        <Link href="/pos/appel" target="_blank" className="touch inline-flex h-11 items-center gap-2 rounded-xl border border-line px-3 text-sm font-semibold hover:surface-2"><ExternalLink className="h-4 w-4" />Écran d&apos;appel</Link>
        <Button variant="accent" size="lg" onClick={() => setCreating(true)} data-testid="takeaway-new"><Plus className="h-5 w-5" />Nouvelle commande</Button>
      </div>

      {/* Téléphone : une colonne à la fois */}
      <div className="flex gap-1.5 overflow-x-auto px-3 pt-3 lg:hidden">
        {cols.map((c) => (
          <button key={c.key} onClick={() => setMobileCol(c.key)} aria-pressed={activeCol === c.key} className={`touch shrink-0 rounded-full px-4 py-2 text-sm font-bold ${activeCol === c.key ? "bg-brand text-white" : "card text-muted"}`}>
            {c.emoji} {c.title} <span className="ml-1 opacity-80">{b?.[c.key].length ?? 0}</span>
          </button>
        ))}
      </div>

      {q.isLoading ? <div className="flex flex-1 items-center justify-center"><Spinner /></div> : (
        <div className={`grid min-h-0 flex-1 gap-4 overflow-y-auto p-3 sm:p-5 ${cols.length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-2"}`}>
          {cols.map((c) => (
            <section key={c.key} className={`min-w-0 ${activeCol === c.key ? "" : "hidden lg:block"}`} data-testid={`takeaway-col-${c.key}`}>
              <h2 className="mb-3 hidden items-center gap-2 lg:flex">
                <span className={`flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br text-base ${c.tone}`} aria-hidden>{c.emoji}</span>
                <span className="text-sm font-extrabold">{c.title}</span>
                <span className="rounded-full surface-2 px-2 py-0.5 text-xs font-bold">{b?.[c.key].length ?? 0}</span>
              </h2>
              <div className="space-y-3">
                {b?.[c.key].length ? b[c.key].map((o) => <TakeawayTicket key={o.id} o={o} now={now} tz={tz} currency={currency} />) : (
                  <p className="rounded-2xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">{c.key === "ready" ? "🌺 " : ""}{c.empty}</p>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
      {creating ? <NewTakeaway onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

function TakeawayTicket({ o, now, tz, currency }: { o: TakeawayCard; now: number; tz: string; currency: string }) {
  const act = useAction();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const ch = CHANNEL[o.channel] ?? CHANNEL.TAKEAWAY;
  const step = async (s: "ready" | "not_ready" | "picked_up", success: string) => {
    setBusy(true);
    await act(() => api.post(`/api/orders/${o.id}/takeaway`, { step: s }), { success, invalidate: [["takeaway"], ["orders"]] });
    setBusy(false);
  };
  const accept = async () => {
    setBusy(true);
    await act(() => api.post(`/api/online-orders/${o.id}/accept`), { success: "Commande acceptée et envoyée en cuisine", invalidate: [["takeaway"], ["orders"], ["kitchen"]] });
    setBusy(false);
  };
  const late = o.pickupAt ? minutesTo(o.pickupAt, now) : null;
  const waited = -minutesTo(o.openedAt, now);
  const tone = o.stage === "ready" ? "bg-emerald-500" : o.stage === "to_accept" ? "bg-sky-500" : "bg-orange-500";
  const pct = o.items ? Math.round((o.itemsReady / o.items) * 100) : 0;

  return (
    <article className={`card relative overflow-hidden p-3 sm:p-4 ${o.stage === "ready" ? "ring-2 ring-emerald-400/60" : ""}`} data-testid="takeaway-card" data-call={o.call}>
      <div className="flex items-start gap-3">
        <div className={`flex h-14 min-w-14 shrink-0 items-center justify-center rounded-2xl px-2 text-2xl font-black text-white shadow-sm ${tone}`} aria-label={`Numéro ${o.call}`}>{o.call}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full surface-2 px-2 py-0.5 text-[11px] font-bold">{ch.emoji} {ch.label}</span>
            {o.paid ? <span className="rounded-full bg-emerald-500/12 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">Payée</span> : <span className="rounded-full bg-orange-500/12 px-2 py-0.5 text-[11px] font-bold text-orange-700 dark:text-orange-300">À encaisser · {formatMoney(o.total, currency)}</span>}
          </div>
          <p className="mt-1 truncate text-base font-extrabold">{o.name ?? "Client"}</p>
          <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted">
            {o.phone ? <a href={`tel:${o.phone.replace(/[^+\d]/g, "")}`} className="inline-flex items-center gap-1 font-semibold text-lagon-600"><Phone className="h-3 w-3" />{o.phone}</a> : null}
            {o.pickupAt ? (
              <span className={late !== null && late < 0 && o.stage !== "ready" ? "font-bold text-red-600" : ""}>
                Retrait {formatTime(o.pickupAt, tz)} · {late === null ? "" : late > 0 ? `dans ${late} min` : late === 0 ? "maintenant" : `en retard de ${-late} min`}
              </span>
            ) : o.when ? <span>Souhaité : {o.when}</span> : <span>Arrivée il y a {Math.max(0, waited)} min</span>}
          </p>
          {o.address ? <p className="mt-0.5 truncate text-xs text-muted">📍 {o.address}</p> : null}
        </div>
      </div>

      {o.stage !== "to_accept" ? (
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-[11px] font-semibold text-muted">
            <span>{o.itemsSent === 0 ? "Pas encore envoyée en cuisine" : `${o.itemsReady}/${o.items} article${o.items > 1 ? "s" : ""} prêt${o.itemsReady > 1 ? "s" : ""}`}</span>
            {o.readyAt ? <span className="text-emerald-600">prête à {formatTime(o.readyAt, tz)}</span> : null}
          </div>
          <div className="h-2 overflow-hidden rounded-full surface-2"><div className={`h-full rounded-full transition-all duration-500 ${o.stage === "ready" ? "bg-emerald-500" : "bg-orange-400"}`} style={{ width: `${o.stage === "ready" ? 100 : pct}%` }} /></div>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {o.stage === "to_accept" ? <Button size="md" className="flex-1" loading={busy} onClick={accept}>Accepter → cuisine</Button> : null}
        {o.stage === "preparing" ? <Button size="md" className="flex-1" loading={busy} onClick={() => step("ready", `N° ${o.call} prête : numéro appelé`)} data-testid="takeaway-ready"><Bell className="h-4 w-4" />Prête</Button> : null}
        {o.stage === "ready" && o.paid ? <Button size="md" className="flex-1 !bg-emerald-600" loading={busy} onClick={() => step("picked_up", `N° ${o.call} remise au client`)} data-testid="takeaway-picked"><Check className="h-4 w-4" />{o.channel === "DELIVERY" ? "Partie en livraison" : "Remise au client"}</Button> : null}
        {o.stage === "ready" && !o.paid ? <Button size="md" variant="accent" className="flex-1" onClick={() => router.push(`/pos/order/${o.id}`)}>Encaisser</Button> : null}
        {o.stage === "ready" && o.readyAt ? <Button size="md" variant="ghost" loading={busy} onClick={() => step("not_ready", "Remise en préparation")} title="Pas encore prête" aria-label="Pas encore prête"><Undo2 className="h-4 w-4" /></Button> : null}
        <Button size="md" variant="secondary" onClick={() => router.push(`/pos/order/${o.id}`)}>Ouvrir</Button>
      </div>
    </article>
  );
}

/** Heure de retrait : dans N minutes (arrondi aux 5 minutes), en ISO. */
function inMinutes(n: number) {
  const d = new Date(Date.now() + n * 60000);
  d.setSeconds(0, 0);
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5);
  return d.toISOString();
}

/** Nouvelle commande à emporter : nom, téléphone et heure de retrait en un geste, puis la prise de commande. */
function NewTakeaway({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const act = useAction();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [delay, setDelay] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    const id = crypto.randomUUID();
    const r = await act(() => api.post<{ id: string }>("/api/orders", { id, type: "TAKEAWAY", customerName: name.trim() || null, customerPhone: phone.trim() || null, pickupAt: delay === null ? null : inMinutes(delay) }, { idempotencyKey: id }), { invalidate: [["takeaway"]] });
    setBusy(false);
    if (r) router.push(`/pos/order/${r.id}`);
  };
  return (
    <Modal open onClose={onClose} title="Nouvelle commande à emporter" size="sm" footer={<Button className="w-full" size="lg" loading={busy} onClick={create} data-testid="takeaway-create">Prendre la commande</Button>}>
      <div className="space-y-3">
        <label className="block"><span className="mb-1 block text-xs font-bold uppercase text-muted">Nom du client</span><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Hina" className="h-12 w-full rounded-xl border border-line surface px-3 text-base" /></label>
        <label className="block"><span className="mb-1 block text-xs font-bold uppercase text-muted">Téléphone (facultatif)</span><input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="87 00 00 00" className="h-12 w-full rounded-xl border border-line surface px-3 text-base" /></label>
        <div>
          <span className="mb-1 block text-xs font-bold uppercase text-muted">Retrait</span>
          <div className="grid grid-cols-3 gap-2">
            {[null, 15, 30, 45, 60, 90].map((m) => (
              <button key={String(m)} type="button" onClick={() => setDelay(m)} aria-pressed={delay === m} className={`touch h-12 rounded-xl text-sm font-bold transition ${delay === m ? "bg-brand text-white shadow-glow" : "surface-2"}`}>
                {m === null ? "Dès que possible" : m < 60 ? `${m} min` : m === 60 ? "1 h" : "1 h 30"}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
