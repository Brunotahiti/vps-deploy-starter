"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api, ApiClientError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Logo, BrandPanel } from "@/components/brand";
import { useQueryClient } from "@tanstack/react-query";
import { WelcomeSplash } from "@/components/welcome-splash";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [welcome, setWelcome] = useState<{ name: string; next: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const u = await api.post<{ firstName: string }>("/api/auth/login", { email, password });
      await qc.invalidateQueries();
      const next = params.get("next") || "/";
      router.prefetch(next);
      setWelcome({ name: u.firstName, next });
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Connexion impossible");
      setLoading(false);
    }
  };

  if (welcome) return <WelcomeSplash name={welcome.name} onDone={() => router.replace(welcome.next)} />;
  return (
    <form onSubmit={submit} className="rise w-full max-w-sm space-y-5">
      <div><Logo size={44} /><h1 className="mt-6 text-2xl font-extrabold tracking-tight">Bon retour</h1><p className="text-sm text-muted">Connectez-vous pour ouvrir la caisse ou l&apos;administration.</p></div>
      <Field label="Email"><Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="vous@restaurant.pf" /></Field>
      <Field label="Mot de passe"><Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      {error ? <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      <Button type="submit" size="lg" className="w-full" loading={loading}>Se connecter</Button>
      <div className="flex items-center justify-between text-sm">
        <Link href="/pos/login" className="text-lagon-600 hover:underline">Connexion par PIN</Link>
        <Link href="/signup" className="text-lagon-600 hover:underline">Créer un compte</Link>
      </div>
      <p className="rounded-xl surface-2 px-3 py-2 text-center text-xs text-muted">Démo : <span className="font-semibold">demo@manaresto.pf</span> · <span className="font-semibold">demo1234</span></p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <BrandPanel />
      <section className="flex flex-col items-center justify-center p-6 sm:p-10">
        <div className="bg-lagoon mb-8 flex w-full max-w-sm items-center gap-3 rounded-3xl p-4 text-white shadow-lift lg:hidden"><Logo size={40} light withText={false} /><span className="text-sm font-semibold leading-snug">La caisse pensée pour les restaurants du fenua.<span className="block text-xs font-normal text-lagon-100/90">Hors ligne, TVA PF, cuisine et statistiques en temps réel.</span></span></div>
        <Suspense><LoginForm /></Suspense>
      </section>
    </main>
  );
}
