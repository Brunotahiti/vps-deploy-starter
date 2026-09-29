"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api, ApiClientError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Logo } from "@/components/brand";
import { useQueryClient } from "@tanstack/react-query";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post("/api/auth/login", { email, password });
      await qc.invalidateQueries();
      router.replace(params.get("next") || "/");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Connexion impossible");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="surface w-full max-w-sm space-y-4 rounded-2xl border p-6 shadow-xl">
      <div className="flex justify-center"><Logo size={48} /></div>
      <p className="text-center text-sm text-muted">La gestion complète de votre restaurant</p>
      <Field label="Email"><Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="vous@restaurant.pf" /></Field>
      <Field label="Mot de passe"><Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      {error ? <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      <Button type="submit" size="lg" className="w-full" loading={loading}>Se connecter</Button>
      <div className="flex items-center justify-between text-sm">
        <Link href="/pos/login" className="text-lagon-600 hover:underline">Connexion par PIN</Link>
        <Link href="/signup" className="text-lagon-600 hover:underline">Créer un compte</Link>
      </div>
      <p className="rounded-lg surface-2 px-3 py-2 text-center text-xs text-muted">Démo : demo@manaresto.pf / demo1234</p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-lagon-50 via-[var(--bg)] to-sable-100 p-4 dark:from-nuit-900 dark:via-nuit-800 dark:to-nuit-950">
      <Suspense><LoginForm /></Suspense>
    </main>
  );
}
