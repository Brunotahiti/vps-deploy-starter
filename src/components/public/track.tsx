"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ChefHat, Clock, PackageCheck, XCircle } from "lucide-react";
import { api } from "@/lib/api-client";
import { Spinner } from "@/components/ui/misc";
import { Money } from "@/components/money";
import { Logo } from "@/components/brand";
import { usePublicLang, LangSwitch, type Key } from "@/lib/i18n/public";
import type { trackOrder } from "@/server/services/public";

type Data = Awaited<ReturnType<typeof trackOrder>>;
const STAGES = ["RECEIVED", "ACCEPTED", "PREPARING", "READY", "DONE"] as const;

/** Suivi public d'une commande (en ligne, livraison, borne). */
export function TrackScreen({ token }: { token: string }) {
  const { lang, setLang, t } = usePublicLang();
  const q = useQuery({ queryKey: ["track", token], queryFn: () => api.get<Data>(`/api/public/track/${token}`), refetchInterval: 8_000 });
  const d = q.data;
  if (q.isLoading) return <div className="flex h-dvh items-center justify-center"><Spinner /></div>;
  if (!d) return <main className="p-8 text-center text-muted">Commande introuvable.</main>;
  const idx = STAGES.indexOf(d.stage as (typeof STAGES)[number]);
  const icons = [Clock, CheckCircle2, ChefHat, PackageCheck, CheckCircle2];
  const meta = d.channelMeta;
  return (
    <div className="mx-auto max-w-xl px-4 pb-10 pt-4">
      <header className="mb-4 flex items-center gap-3"><Logo size={36} withText={false} /><div className="min-w-0 flex-1"><p className="truncate text-lg font-extrabold">{d.establishment.name}</p><p className="text-xs text-muted">{t("orderNumber")} {d.number.split("-")[1] ?? d.number}</p></div><LangSwitch lang={lang} setLang={setLang} /></header>
      <div className="card p-5">
        {d.stage === "CANCELLED" ? <p className="flex items-center gap-2 text-lg font-bold text-red-600"><XCircle className="h-6 w-6" />{t("stageCANCELLED")}{d.cancelReason ? <span className="text-sm font-normal text-muted">· {d.cancelReason}</span> : null}</p> : (
          <ol className="space-y-3">
            {STAGES.map((s, i) => { const I = icons[i]; const done = i <= idx; const current = i === idx; return <li key={s} className={`flex items-center gap-3 ${done ? "" : "opacity-40"}`}><span className={`flex h-9 w-9 items-center justify-center rounded-full ${current ? "bg-brand text-white shadow-glow pulse-soft" : done ? "bg-green-500/15 text-green-700" : "surface-2"}`}><I className="h-5 w-5" /></span><span className={`text-sm ${current ? "font-extrabold" : "font-semibold"}`}>{t(`stage${s}` as Key)}</span></li>; })}
          </ol>
        )}
        {d.stage === "READY" || d.stage === "DONE" ? <p className="mt-4 rounded-xl bg-green-500/10 px-3 py-2 text-center text-sm font-bold text-green-700">{t("thanks")}</p> : null}
      </div>
      <div className="card mt-3 p-4 text-sm">
        <p className="mb-1 text-xs font-bold uppercase text-muted">{meta.channel === "DELIVERY" ? t("delivery") : meta.channel === "KIOSK" ? "Borne" : t("pickup")}{meta.when ? ` · ${meta.when}` : ""}</p>
        {meta.address ? <p className="mb-2 text-muted">{String(meta.address)}{meta.zone ? ` (${meta.zone})` : ""}</p> : null}
        <ul className="divide-y divide-[var(--border)]">{d.items.map((i) => <li key={i.id} className="flex justify-between py-1.5"><span>{i.quantity} × {i.name}{i.modifiers.length ? <span className="block text-xs text-muted">{i.modifiers.map((m) => m.name).join(", ")}</span> : null}</span><Money amount={i.lineTotal} /></li>)}</ul>
        {meta.deliveryFee ? <div className="mt-2 flex justify-between text-muted"><span>{t("deliveryFee")}</span><Money amount={meta.deliveryFee} /></div> : null}
        <div className="mt-2 flex justify-between border-t border-line pt-2 text-lg font-extrabold"><span>{t("total")}</span><Money amount={d.totalWithFee} /></div>
        {meta.channel === "KIOSK" ? <p className="mt-2 text-center text-xs text-muted">{t("kioskDone")}</p> : null}
      </div>
      <p className="mt-3 text-center text-xs text-muted">{d.establishment.addressLine1} {d.establishment.city} {d.establishment.phone ? `· ${d.establishment.phone}` : ""}</p>
    </div>
  );
}
