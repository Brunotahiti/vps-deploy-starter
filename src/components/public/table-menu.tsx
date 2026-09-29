"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, CheckCircle2 } from "lucide-react";
import { api, ApiClientError } from "@/lib/api-client";
import { Spinner } from "@/components/ui/misc";
import { Money } from "@/components/money";
import { Logo } from "@/components/brand";
import { useToast } from "@/components/ui/toast";
import { usePublicLang, LangSwitch } from "@/lib/i18n/public";
import { MenuBrowser, Cart, toLines, type CartLine } from "./menu-browser";
import type { tableMenu } from "@/server/services/public";

type Data = Awaited<ReturnType<typeof tableMenu>>;

/** Page publique du QR code de table : menu, appel serveur, commande depuis la table selon le mode. */
export function TableMenuScreen({ token }: { token: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { lang, setLang, t } = usePublicLang();
  const q = useQuery({ queryKey: ["public-menu", token], queryFn: () => api.get<Data>(`/api/public/menu/${token}`), refetchInterval: 20_000 });
  const [cart, setCart] = useState<CartLine[]>([]);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [called, setCalled] = useState(false);
  const d = q.data;
  if (q.isLoading) return <div className="flex h-dvh items-center justify-center"><Spinner /></div>;
  if (!d) return <main className="p-8 text-center text-muted">QR code inconnu.</main>;
  const canOrder = d.mode === "ORDER" || d.mode === "ORDER_DIRECT";
  const call = async () => { try { await api.post(`/api/public/menu/${token}/call`, {}); setCalled(true); setTimeout(() => setCalled(false), 60_000); } catch (e) { toast(e instanceof ApiClientError ? e.message : "Erreur", "error"); } };
  const send = async () => {
    setSending(true);
    try { await api.post(`/api/public/menu/${token}/order`, { id: crypto.randomUUID(), lines: toLines(cart), notes: note || null }); setCart([]); setNote(""); toast(t("sent"), "success"); qc.invalidateQueries({ queryKey: ["public-menu", token] }); }
    catch (e) { toast(e instanceof ApiClientError ? e.message : "Erreur", "error"); }
    finally { setSending(false); }
  };
  return (
    <div className="mx-auto max-w-5xl px-3 pb-32 pt-3 sm:px-4">
      <header className="mb-3 flex items-center gap-3">
        <Logo size={36} withText={false} />
        <div className="min-w-0 flex-1"><p className="truncate text-lg font-extrabold">{d.establishment.name}</p><p className="text-xs text-muted">{t("table")} {d.table.name} · {d.table.room}</p></div>
        <LangSwitch lang={lang} setLang={setLang} />
      </header>
      {d.mode !== "MENU" ? <button onClick={call} disabled={called} className={`touch mb-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-sm font-bold ${called ? "bg-green-500/15 text-green-700" : "bg-accent text-white shadow-lift"}`}>{called ? <><CheckCircle2 className="h-5 w-5" />{t("called")}</> : <><BellRing className="h-5 w-5" />{t("callWaiter")}</>}</button> : <p className="mb-3 rounded-xl surface-2 px-3 py-2 text-center text-xs text-muted">{t("closedMenu")}</p>}
      {d.order && d.order.items.length ? (
        <div className="card mb-3 p-3 text-sm"><p className="mb-1 font-bold">{t("ordered")} · <Money amount={d.order.total} /></p><ul className="text-xs text-muted">{d.order.items.map((i) => <li key={i.id}>{i.quantity} × {i.name}{i.modifiers.length ? ` (${i.modifiers.map((m) => m.name).join(", ")})` : ""} — {i.status === "PENDING" ? t("awaiting") : i.status === "READY" || i.status === "SERVED" ? t("ready") : t("inKitchen")}</li>)}</ul></div>
      ) : null}
      <div className={canOrder ? "grid gap-4 lg:grid-cols-[1fr_340px]" : ""}>
        <MenuBrowser catalog={d.catalog} cart={cart} setCart={setCart} t={t} readOnly={!canOrder} />
        {canOrder ? <div className="lg:sticky lg:top-3 lg:self-start"><Cart cart={cart} setCart={setCart} t={t} note={note} setNote={setNote} action={send} actionLabel={sending ? "…" : t("send")} disabled={sending} /></div> : null}
      </div>
      {canOrder && cart.length ? <div className="fixed inset-x-0 bottom-0 z-20 p-3 lg:hidden" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}><button onClick={send} disabled={sending} className="touch glass flex h-14 w-full items-center justify-between rounded-2xl border px-5 shadow-lift"><span className="font-bold">{t("send")} · {cart.reduce((a, l) => a + l.quantity, 0)}</span><Money amount={cart.reduce((a, l) => a + l.unitPrice * l.quantity, 0)} className="text-lg font-extrabold" /></button></div> : null}
    </div>
  );
}
