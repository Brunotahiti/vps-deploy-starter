"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { safeNext } from "@/lib/safe-next";
import { Mail, Lock, Eye, EyeOff, ArrowRight, KeyRound, Sparkles } from "lucide-react";
import { api, ApiClientError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Logo, BrandPanel, BrandHeaderMobile } from "@/components/brand";
import { useQueryClient } from "@tanstack/react-query";
import { WelcomeSplash } from "@/components/welcome-splash";
import { InstallAppButton } from "@/components/install-app";

const DEMO = { email: "demo@manaresto.pf", password: "demo1234" };

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<"form" | "demo" | null>(null);
  const [welcome, setWelcome] = useState<{ name: string; next: string } | null>(null);

  const login = async (creds: { email: string; password: string }, kind: "form" | "demo") => {
    setLoading(kind);
    setError(null);
    try {
      const u = await api.post<{ firstName: string }>("/api/auth/login", creds);
      await qc.invalidateQueries();
      const next = safeNext(params.get("next"), "/");
      router.prefetch(next);
      setWelcome({ name: u.firstName, next });
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Connexion impossible");
      setLoading(null);
    }
  };
  const submit = (e: React.FormEvent) => { e.preventDefault(); void login({ email, password }, "form"); };
  const demo = () => { setEmail(DEMO.email); setPassword(DEMO.password); void login(DEMO, "demo"); };

  if (welcome) return <WelcomeSplash name={welcome.name} onDone={() => router.replace(welcome.next)} />;
  const field = "flex h-14 items-center gap-3 rounded-2xl border border-line surface px-4 transition focus-within:border-lagon-500 focus-within:ring-4 focus-within:ring-lagon-500/15";
  return (
    <form onSubmit={submit} className="brand-rise w-full max-w-md">
      <div className="hidden lg:block"><Logo size={48} /></div>
      <p className="mt-8 text-sm font-bold uppercase tracking-[0.18em] text-lagon-600 max-lg:mt-0">Ia ora na 👋</p>
      <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-[2.2rem]">Heureux de vous revoir</h1>
      <p className="mt-2 text-[15px] text-muted">Connectez-vous pour ouvrir votre caisse, votre salle et votre tableau de bord.</p>

      <div className="mt-8 space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted">E-mail</span>
          <span className={field}><Mail className="h-5 w-5 shrink-0 text-muted" /><input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="vous@restaurant.pf" className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted/70" /></span>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted">Mot de passe</span>
          <span className={field}><Lock className="h-5 w-5 shrink-0 text-muted" /><input type={show ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Votre mot de passe" className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted/70" /><button type="button" onClick={() => setShow((v) => !v)} className="touch -mr-1 rounded-lg p-1.5 text-muted hover:text-[var(--text)]" aria-label={show ? "Masquer la saisie" : "Afficher la saisie"} title={show ? "Masquer" : "Afficher"}>{show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}</button></span>
        </label>
      </div>

      {error ? <p role="alert" className="mt-4 rounded-xl bg-red-500/10 px-3 py-2.5 text-sm font-semibold text-red-600 dark:text-red-400">{error}</p> : null}

      <Button type="submit" size="lg" className="group mt-6 h-14 w-full rounded-2xl text-base" loading={loading === "form"}>Se connecter<ArrowRight className="h-5 w-5 transition group-hover:translate-x-1" /></Button>

      <div className="my-6 flex items-center gap-3 text-xs font-semibold uppercase tracking-wide text-muted"><span className="h-px flex-1 bg-[var(--border)]" />ou<span className="h-px flex-1 bg-[var(--border)]" /></div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Link href="/pos/login" className="touch flex h-12 items-center justify-center gap-2 rounded-2xl border border-line surface text-sm font-bold transition hover:border-lagon-500 hover:text-lagon-700"><KeyRound className="h-4 w-4" />Connexion par PIN</Link>
        <button type="button" onClick={demo} disabled={loading !== null} className="touch flex h-12 items-center justify-center gap-2 rounded-2xl bg-corail-500/12 text-sm font-bold text-corail-600 transition hover:bg-corail-500/20 disabled:opacity-60" data-testid="demo-login"><Sparkles className="h-4 w-4" />{loading === "demo" ? "Ouverture…" : "Essayer la démo"}</button>
      </div>

      <p className="mt-8 rounded-2xl bg-lagon-500/10 px-4 py-3.5 text-center text-sm text-lagon-800 dark:text-lagon-200">Pas encore de compte ? <Link href="/signup" className="font-extrabold underline-offset-2 hover:underline">Créer mon compte gratuit</Link><span className="block text-xs opacity-80">15 jours d&apos;essai · sans carte bancaire · 0 % de commission</span></p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.15fr_1fr]">
      <BrandPanel />
      <section className="relative flex flex-col items-center justify-center bg-[var(--bg)] p-6 sm:p-10">
        <div className="w-full max-w-md lg:hidden"><BrandHeaderMobile /></div>
        <Suspense><LoginForm /></Suspense>
        <Suspense><InstallCta /></Suspense>
      </section>
    </main>
  );
}

/** Installation discrète sous le formulaire (guide ouvert automatiquement depuis le site vitrine avec ?install=1). */
function InstallCta() {
  const params = useSearchParams();
  return (
    <div className="mt-6 flex w-full max-w-md flex-col items-center justify-center gap-2 text-center text-sm text-muted sm:flex-row">
      <span>Sur tablette ou téléphone :</span>
      <InstallAppButton variant="outline" className="h-10 rounded-xl px-3 text-sm" autoOpen={params.get("install") === "1"} label="Installer l'application" compact />
    </div>
  );
}
