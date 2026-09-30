"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { api, ApiClientError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Spinner } from "@/components/ui/misc";
import { BrandPanel, BrandHeaderMobile } from "@/components/brand";
import { WelcomeSplash } from "@/components/welcome-splash";
import type { getInvitation } from "@/server/services/invitations";

type Invite = Awaited<ReturnType<typeof getInvitation>>;

/** Page d'acceptation d'une invitation : l'employé choisit son mot de passe et son PIN, puis entre directement dans l'application. */
export function InvitationScreen({ token }: { token: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["invitation", token], queryFn: () => api.get<Invite>(`/api/invitations/${token}`), retry: false });
  const [f, setF] = useState({ password: "", confirm: "", pin: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [welcome, setWelcome] = useState<string | null>(null);
  const inv = q.data;
  const valid = f.password.length >= 8 && f.password === f.confirm && (f.pin === "" || /^\d{4,6}$/.test(f.pin));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || !inv) return;
    setBusy(true); setError(null);
    try {
      await api.post(`/api/invitations/${token}/accept`, { password: f.password, pin: f.pin || null });
      qc.clear();
      setWelcome(inv.firstName);
    } catch (err) { setError(err instanceof ApiClientError ? err.message : "Erreur"); setBusy(false); }
  };
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.15fr_1fr]">
      <BrandPanel />
      <section className="flex items-center justify-center bg-[var(--bg)] p-6 sm:p-10">
        <div className="w-full max-w-md">
          <div className="lg:hidden"><BrandHeaderMobile /></div>
          {q.isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : !inv ? (
            <div className="card p-6 text-center"><p className="text-lg font-extrabold">Invitation introuvable</p><p className="mt-2 text-sm text-muted">Ce lien a déjà été utilisé ou n&apos;existe pas. Demandez à votre manager de vous renvoyer une invitation.</p><Link href="/login" className="mt-4 inline-block text-sm font-bold text-lagon-600">Aller à la connexion</Link></div>
          ) : inv.expired ? (
            <div className="card p-6 text-center"><p className="text-lg font-extrabold">Invitation expirée</p><p className="mt-2 text-sm text-muted">Le lien de {inv.organizationName} n&apos;est plus valable. Demandez à votre manager de renvoyer l&apos;invitation.</p></div>
          ) : (
            <form onSubmit={submit} className="space-y-4" data-testid="invitation-form">
              <div>
                <p className="mb-2 inline-block rounded-full bg-lagon-500/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-lagon-700 dark:text-lagon-300">{inv.organizationName}</p>
                <h1 className="text-3xl font-extrabold tracking-tight">Bienvenue, {inv.firstName} !</h1>
                <p className="mt-2 text-sm text-muted">Choisissez votre mot de passe et votre code PIN de caisse pour rejoindre l&apos;équipe.</p>
                {inv.memberships.length ? <ul className="mt-3 flex flex-wrap gap-1.5">{inv.memberships.map((m, i) => <li key={i} className="rounded-lg surface-2 px-2 py-1 text-xs font-semibold">{m.role} · {m.establishment}</li>)}</ul> : null}
              </div>
              <Field label="Adresse e-mail"><Input value={inv.email} readOnly className="opacity-70" /></Field>
              <Field label="Mot de passe (8 caractères minimum)"><Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" required minLength={8} /></Field>
              <Field label="Confirmer le mot de passe"><Input type="password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} autoComplete="new-password" required /></Field>
              <Field label="PIN de caisse (4 à 6 chiffres, facultatif)" hint="Il sert à vous identifier en un geste sur la caisse et la pointeuse."><Input inputMode="numeric" value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, "").slice(0, 6) })} /></Field>
              {f.confirm && f.password !== f.confirm ? <p className="text-sm font-semibold text-red-600">Les deux mots de passe ne correspondent pas.</p> : null}
              {error ? <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-600">{error}</p> : null}
              <Button type="submit" className="w-full" disabled={!valid || busy}>{busy ? "Création…" : "Créer mon accès et entrer"}</Button>
            </form>
          )}
        </div>
      </section>
      {welcome ? <WelcomeSplash name={welcome} onDone={() => router.replace("/pos")} /> : null}
    </main>
  );
}
