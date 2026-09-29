"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, ApiClientError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Logo, BrandPanel } from "@/components/brand";

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({ organizationName: "", establishmentName: "", firstName: "", lastName: "", email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post("/api/auth/signup", form);
      router.replace("/onboarding");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Inscription impossible");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <BrandPanel />
      <section className="flex items-center justify-center p-6 sm:p-10">
      <form onSubmit={submit} className="rise w-full max-w-lg space-y-4">
        <Logo size={44} />
        <h1 className="text-2xl font-extrabold tracking-tight">Créer votre espace ManaResto</h1>
        <p className="text-sm text-muted">Entreprise, premier établissement et compte propriétaire. Vous pourrez ajouter d&apos;autres restaurants ensuite.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Entreprise" className="sm:col-span-2"><Input required value={form.organizationName} onChange={set("organizationName")} placeholder="Ma société SARL" /></Field>
          <Field label="Nom du restaurant" className="sm:col-span-2"><Input required value={form.establishmentName} onChange={set("establishmentName")} placeholder="Le Mana Beach" /></Field>
          <Field label="Prénom"><Input required value={form.firstName} onChange={set("firstName")} /></Field>
          <Field label="Nom"><Input required value={form.lastName} onChange={set("lastName")} /></Field>
          <Field label="Email" className="sm:col-span-2"><Input type="email" required value={form.email} onChange={set("email")} /></Field>
          <Field label="Mot de passe (8 caractères min.)" className="sm:col-span-2"><Input type="password" required minLength={8} value={form.password} onChange={set("password")} /></Field>
        </div>
        {error ? <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600">{error}</p> : null}
        <Button type="submit" size="lg" className="w-full" loading={loading}>Créer mon compte</Button>
        <p className="text-center text-sm"><Link href="/login" className="text-lagon-600 hover:underline">Déjà un compte ? Se connecter</Link></p>
      </form>
      </section>
    </main>
  );
}
