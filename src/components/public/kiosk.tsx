"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api, ApiClientError } from "@/lib/api-client";
import { Spinner } from "@/components/ui/misc";
import { Money } from "@/components/money";
import { Logo } from "@/components/brand";
import { useToast } from "@/components/ui/toast";
import { usePublicLang, LangSwitch } from "@/lib/i18n/public";
import { MenuBrowser, Cart, toLines, type CartLine, type PublicCatalog } from "./menu-browser";
import type { DigitalSettings } from "@/server/services/public";

type Data = { establishment: { id: string; name: string }; terminal: { name: string; kind: string }; kiosk: DigitalSettings["kiosk"]; catalog: PublicCatalog };
type Done = { number: string; publicToken: string; totalWithFee: number };

/** Borne de commande : accueil → sur place / à emporter → menu → prénom → numéro d'appel, paiement en caisse. */
export function KioskScreen() {
  const { toast } = useToast();
  const { lang, setLang, t } = usePublicLang();
  const q = useQuery({ queryKey: ["kiosk"], queryFn: () => api.get<Data>("/api/kiosk/catalog"), refetchInterval: 60_000, retry: false });
  const [step, setStep] = useState<"welcome" | "mode" | "menu" | "name" | "done">("welcome");
  const [mode, setMode] = useState<"DINE_IN" | "TAKEAWAY">("DINE_IN");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [name, setName] = useState("");
  const [done, setDone] = useState<Done | null>(null);
  const [sending, setSending] = useState(false);
  useEffect(() => { if (step !== "done") return; const tm = setTimeout(() => { setStep("welcome"); setCart([]); setName(""); setDone(null); }, 25_000); return () => clearTimeout(tm); }, [step]);
  const d = q.data;
  if (q.isLoading) return <div className="flex h-dvh items-center justify-center"><Spinner /></div>;
  if (!d) return <main className="mx-auto max-w-md p-8 text-center"><Logo size={44} /><p className="mt-4 font-bold">Cet appareil n&apos;est pas enregistré comme borne.</p><p className="mt-1 text-sm text-muted">Un manager doit se connecter, puis enregistrer l&apos;appareil dans Administration → Paramètres → Terminaux (type « Borne »).</p><Link href="/login" className="mt-4 inline-block rounded-xl bg-brand px-4 py-2 font-semibold text-white">Connexion</Link></main>;
  if (!d.kiosk.enabled) return <main className="p-8 text-center text-muted">La borne n&apos;est pas activée (Administration → Digital).</main>;
  const submit = async () => {
    setSending(true);
    try { const r = await api.post<Done>("/api/kiosk/order", { id: crypto.randomUUID(), mode, name: name || null, lines: toLines(cart), lang }); setDone(r); setStep("done"); }
    catch (e) { toast(e instanceof ApiClientError ? e.message : "Erreur", "error"); }
    finally { setSending(false); }
  };
  const total = cart.reduce((a, l) => a + l.unitPrice * l.quantity, 0);
  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line px-4"><Logo size={36} /><span className="min-w-0 flex-1 truncate text-lg font-extrabold">{d.establishment.name}</span><LangSwitch lang={lang} setLang={setLang} /></header>
      {step === "welcome" ? <button onClick={() => setStep("mode")} className="touch bg-lagoon flex flex-1 flex-col items-center justify-center gap-4 text-white"><Logo size={96} withText={false} /><p className="text-5xl font-extrabold tracking-tight">{t("kioskWelcome")}</p><p className="pulse-soft text-2xl font-semibold">{t("kioskStart")}</p></button> : null}
      {step === "mode" ? <div className="flex flex-1 items-center justify-center gap-6 p-8">{d.kiosk.dineIn ? <button onClick={() => { setMode("DINE_IN"); setStep("menu"); }} className="touch card flex h-64 w-64 flex-col items-center justify-center gap-3 text-2xl font-extrabold hover:shadow-lift active:scale-[0.98]"><span className="text-6xl">🍽️</span>{t("dineIn")}</button> : null}{d.kiosk.takeaway ? <button onClick={() => { setMode("TAKEAWAY"); setStep("menu"); }} className="touch card flex h-64 w-64 flex-col items-center justify-center gap-3 text-2xl font-extrabold hover:shadow-lift active:scale-[0.98]"><span className="text-6xl">🥡</span>{t("takeaway")}</button> : null}</div> : null}
      {step === "menu" ? (
        <div className="grid min-h-0 flex-1 gap-4 p-4 lg:grid-cols-[1fr_380px]">
          <div className="min-h-0 overflow-y-auto pr-1"><MenuBrowser catalog={d.catalog} cart={cart} setCart={setCart} t={t} big /></div>
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto"><Cart cart={cart} setCart={setCart} t={t} action={() => setStep("name")} actionLabel={t("validate")} /><button onClick={() => setStep("mode")} className="touch h-12 rounded-xl surface-2 text-sm font-bold">{t("back")}</button></div>
        </div>
      ) : null}
      {step === "name" ? <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 p-6"><p className="text-2xl font-extrabold">{t("firstName")}</p><input value={name} onChange={(e) => setName(e.target.value)} className="h-16 rounded-2xl border border-line surface px-4 text-2xl font-bold" autoFocus /><p className="text-lg">{t("total")} : <Money amount={total} className="font-extrabold" /></p><button disabled={sending} onClick={submit} className="touch h-16 rounded-2xl bg-brand text-xl font-extrabold text-white shadow-glow">{sending ? "…" : t("pay")}</button><button onClick={() => setStep("menu")} className="touch h-12 rounded-xl surface-2 text-sm font-bold">{t("back")}</button></div> : null}
      {step === "done" && done ? <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center"><p className="text-2xl font-bold">{t("thanks")}</p><p className="text-xs font-bold uppercase tracking-widest text-muted">{t("orderNumber")}</p><p className="text-8xl font-extrabold tracking-tight text-brand">{done.number.split("-")[1] ?? done.number}</p><p className="text-lg"><Money amount={done.totalWithFee} className="font-extrabold" /> · {t("kioskDone")}</p><button onClick={() => { setStep("welcome"); setCart([]); setName(""); }} className="touch mt-4 h-14 rounded-2xl surface-2 px-8 text-lg font-bold">{t("newOrder")}</button></div> : null}
    </div>
  );
}
