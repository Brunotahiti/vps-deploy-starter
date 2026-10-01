"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { api, ApiClientError } from "@/lib/api-client";
import { Spinner } from "@/components/ui/misc";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand";
import { useToast } from "@/components/ui/toast";
import { usePublicLang, LangSwitch } from "@/lib/i18n/public";
import { localDay, zonedInputToDate } from "@/lib/dates";

/** Réservation publique : demande à confirmer par le restaurant. */
export function ReserveScreen({ org, est }: { org: string; est: string }) {
  const { toast } = useToast();
  const { lang, setLang, t } = usePublicLang();
  const q = useQuery({ queryKey: ["public-shop", org, est], queryFn: () => api.get<{ establishment: { name: string; phone: string | null; addressLine1: string | null; city: string | null; timezone?: string } }>(`/api/public/shop/${org}/${est}`) });
  const [f, setF] = useState({ name: "", phone: "", email: "", date: localDay(new Date()), time: "19:30", partySize: "2", notes: "", allergies: "" });
  const [done, setDone] = useState(false);
  const [sending, setSending] = useState(false);
  if (q.isLoading) return <div className="flex h-dvh items-center justify-center"><Spinner /></div>;
  if (!q.data) return <main className="p-8 text-center text-muted">Établissement introuvable.</main>;
  const submit = async () => {
    setSending(true);
    try { await api.post(`/api/public/shop/${org}/${est}/reserve`, { name: f.name, phone: f.phone, email: f.email || null, startsAt: zonedInputToDate(`${f.date}T${f.time}`, q.data.establishment.timezone ?? "Pacific/Tahiti").toISOString(), partySize: Number(f.partySize), notes: f.notes || null, allergies: f.allergies || null }); setDone(true); }
    catch (e) { toast(e instanceof ApiClientError ? e.message : "Erreur", "error"); }
    finally { setSending(false); }
  };
  return (
    <div className="mx-auto max-w-lg px-4 pb-10 pt-4">
      <header className="mb-4 flex items-center gap-3"><Logo size={36} withText={false} /><div className="min-w-0 flex-1"><p className="truncate text-lg font-extrabold">{q.data.establishment.name}</p><p className="truncate text-xs text-muted">{[q.data.establishment.addressLine1, q.data.establishment.city, q.data.establishment.phone].filter(Boolean).join(" · ")}</p></div><LangSwitch lang={lang} setLang={setLang} /></header>
      {done ? <div className="card p-8 text-center"><CheckCircle2 className="mx-auto h-12 w-12 text-green-600" /><p className="mt-3 font-bold">{t("booked")}</p></div> : (
        <div className="card space-y-3 p-5">
          <h1 className="text-xl font-extrabold">{t("reserve")}</h1>
          <div className="grid grid-cols-2 gap-3"><Field label={t("date")}><Input type="date" value={f.date} min={localDay(new Date())} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field><Field label={t("time")}><Input type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></Field></div>
          <Field label={t("partySize")}><div className="grid grid-cols-6 gap-2">{[1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20].map((n) => <button key={n} type="button" onClick={() => setF({ ...f, partySize: String(n) })} className={`touch h-11 rounded-lg text-sm font-bold ${f.partySize === String(n) ? "bg-brand text-white" : "surface-2"}`}>{n}</button>)}</div></Field>
          <Field label={t("name")}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" /></Field>
          <Field label={t("phone")}><Input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} autoComplete="tel" /></Field>
          <Field label={t("email")}><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label={t("allergies")}><Input value={f.allergies} onChange={(e) => setF({ ...f, allergies: e.target.value })} /></Field>
          <Field label={t("specialRequests")}><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          <Button size="lg" className="w-full" loading={sending} disabled={f.name.trim().length < 2 || f.phone.trim().length < 6} onClick={submit}>{t("book")}</Button>
        </div>
      )}
    </div>
  );
}
