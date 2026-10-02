"use client";

import { useEffect, useState } from "react";
import { CalendarDays, CheckCircle2, Clock, MapPin, PartyPopper, Users } from "lucide-react";
import { api, ApiClientError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime, formatTime } from "@/lib/dates";
import type { EventLine, EventTaxRow } from "@/lib/catering";

type Quote = {
  establishment: { name: string; legalName: string | null; phone: string | null; email: string | null; timezone: string; currency: string };
  number: string; title: string; kind: string; startsAt: string; endsAt: string; guests: number; location: string | null; clientName: string; clientCompany: string | null;
  lines: EventLine[]; taxes: EventTaxRow[]; totalTtc: number; totalTax: number; totalHt: number; depositAmount: number; quoteNotes: string | null; validUntil: string | null;
  status: "OPEN" | "EXPIRED" | "CANCELLED" | "REVISING" | "ACCEPTED"; acceptedAt: string | null; acceptedBy: string | null;
};

/** Devis vu par le client : détail, total, acompte, et acceptation en ligne (nom + case à cocher). */
export function QuoteView({ token }: { token: string }) {
  const [q, setQ] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get<Quote>(`/api/public/quotes/${token}`).then((r) => { setQ(r); setName(r.clientName); }).catch((e) => setError(e instanceof ApiClientError ? e.message : "Devis introuvable")); }, [token]);
  const accept = async () => {
    setBusy(true); setError(null);
    try { setQ(await api.post<Quote>(`/api/public/quotes/${token}/accept`, { name, agree })); }
    catch (e) { setError(e instanceof ApiClientError ? e.message : "Acceptation impossible : réessayez"); }
    finally { setBusy(false); }
  };
  if (!q) return <main className="flex min-h-dvh items-center justify-center bg-[var(--bg)] p-6"><div className="card max-w-md p-8 text-center"><p className="text-sm text-muted">{error ?? "Chargement du devis…"}</p></div></main>;
  const tz = q.establishment.timezone, money = (n: number) => formatMoney(n, q.establishment.currency);

  return (
    <main className="min-h-dvh bg-[var(--bg)] px-4 py-6 sm:py-10">
      <div className="mx-auto max-w-2xl">
        <header className="overflow-hidden rounded-3xl bg-gradient-to-br from-lagon-500 to-lagon-700 p-6 text-white shadow-lift">
          <p className="text-xs font-bold uppercase tracking-wider opacity-85">{q.establishment.name}</p>
          <h1 className="mt-1 text-2xl font-extrabold sm:text-3xl">{q.title}</h1>
          <p className="mt-1 text-sm opacity-90">Devis {q.number} · pour {q.clientCompany || q.clientName}</p>
          <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
            <p className="flex items-center gap-2"><CalendarDays className="h-4 w-4" />{formatDate(q.startsAt, tz)}</p>
            <p className="flex items-center gap-2"><Clock className="h-4 w-4" />{formatTime(q.startsAt, tz)} – {formatTime(q.endsAt, tz)}</p>
            <p className="flex items-center gap-2"><Users className="h-4 w-4" />{q.guests} personne{q.guests > 1 ? "s" : ""}</p>
            <p className="flex items-center gap-2"><MapPin className="h-4 w-4" />{q.location ?? `Chez ${q.establishment.name}`}</p>
          </div>
        </header>

        <section className="card mt-4 p-5">
          <ul className="divide-y divide-[var(--border)] text-sm">
            {q.lines.map((l, i) => (
              <li key={i} className="flex items-start gap-3 py-2.5">
                <span className="w-12 shrink-0 font-bold tabular-nums">{String(l.quantity).replace(".", ",")} ×</span>
                <span className="min-w-0 flex-1">{l.label}<span className="block text-xs text-muted">{money(l.unitPrice)} l&apos;unité</span></span>
                <span className="font-semibold tabular-nums">{money(Math.round(l.quantity * l.unitPrice))}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 border-t border-line pt-3 text-sm">
            {q.taxes.map((t) => <p key={t.rateBps} className="flex justify-between text-muted"><span>{t.name} (sur {money(t.ht)} HT)</span><span>{money(t.tax)}</span></p>)}
            <p className="mt-1 flex justify-between text-xl font-extrabold"><span>Total TTC</span><span data-testid="quote-total">{money(q.totalTtc)}</span></p>
            {q.depositAmount ? <p className="mt-1 flex justify-between font-semibold text-lagon-700 dark:text-lagon-300"><span>Acompte à la commande</span><span>{money(q.depositAmount)}</span></p> : null}
          </div>
          {q.quoteNotes ? <p className="mt-4 whitespace-pre-line rounded-2xl surface-2 p-3 text-sm">{q.quoteNotes}</p> : null}
        </section>

        <section className="card mt-4 p-5" data-testid="quote-decision">
          {q.status === "ACCEPTED" ? (
            <div className="text-center">
              <CheckCircle2 className="mx-auto h-12 w-12 text-green-600" />
              <h2 className="mt-3 text-xl font-extrabold">Devis accepté</h2>
              <p className="mt-1 text-sm text-muted">{q.acceptedAt ? `${q.acceptedBy ? `Par ${q.acceptedBy}, le` : "Le"} ${formatDateTime(q.acceptedAt, tz)}.` : ""} Māuruuru ! {q.establishment.name} vous recontacte pour {q.depositAmount ? "l'acompte et " : ""}les derniers détails.</p>
            </div>
          ) : q.status === "OPEN" ? (
            <>
              <h2 className="flex items-center gap-2 text-lg font-extrabold"><PartyPopper className="h-5 w-5 text-lagon-600" />Accepter le devis</h2>
              {q.validUntil ? <p className="mt-1 text-sm text-muted">Valable jusqu&apos;au {formatDate(q.validUntil, tz)}.</p> : null}
              <label className="mt-3 block text-sm font-semibold">Votre nom<Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} aria-label="Votre nom" /></label>
              <label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 h-4 w-4" checked={agree} onChange={(e) => setAgree(e.target.checked)} aria-label="J'accepte le devis" /><span>J&apos;ai lu ce devis et je l&apos;accepte{q.depositAmount ? `, avec un acompte de ${money(q.depositAmount)} à la commande` : ""}.</span></label>
              {error ? <p className="mt-3 text-sm font-semibold text-red-600">{error}</p> : null}
              <Button size="lg" className="mt-4 w-full" loading={busy} disabled={!agree || name.trim().length < 2} onClick={accept} data-testid="quote-accept-public">J&apos;accepte le devis</Button>
            </>
          ) : (
            <p className="text-center text-sm text-muted">
              {q.status === "EXPIRED" ? "Ce devis n'est plus valable." : q.status === "CANCELLED" ? "Ce devis a été annulé." : "Ce devis est en cours de modification : vous recevrez la nouvelle version."}
              {q.establishment.phone ? <> Contactez {q.establishment.name} au <strong>{q.establishment.phone}</strong>.</> : null}
            </p>
          )}
        </section>
        <p className="mt-6 text-center text-xs text-muted">{q.establishment.legalName || q.establishment.name}{q.establishment.phone ? ` · ${q.establishment.phone}` : ""}{q.establishment.email ? ` · ${q.establishment.email}` : ""}</p>
      </div>
    </main>
  );
}
