"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiClientError } from "@/lib/api-client";
import { NumPad } from "@/components/ui/numpad";
import { Logo } from "@/components/brand";
import { useSession } from "@/hooks/use-session";
import { WelcomeSplash } from "@/components/welcome-splash";

function PinLogin() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const { me } = useSession();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [welcome, setWelcome] = useState<{ name: string; next: string } | null>(null);

  const submit = async () => {
    if (pin.length < 4) return;
    setLoading(true);
    setError(null);
    try {
      const u = await api.post<{ firstName: string; displayName?: string | null }>("/api/auth/pin", { pin });
      await qc.invalidateQueries();
      const next = params.get("next") || "/pos";
      router.prefetch(next);
      setWelcome({ name: u.displayName || u.firstName, next });
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Erreur");
      setPin("");
      setLoading(false);
    }
  };

  if (welcome) return <WelcomeSplash name={welcome.name} onDone={() => router.replace(welcome.next)} />;

  if (me && !me.terminal) {
    return (
      <div className="card rise w-full max-w-sm space-y-4 p-7 text-center">
        <Logo size={44} />
        <p className="text-sm text-muted">Cet appareil n&apos;est pas encore enregistré comme terminal de caisse. Un manager doit se connecter avec son email puis enregistrer l&apos;appareil dans <strong>Administration → Paramètres → Terminaux</strong>.</p>
        <Link href="/login" className="block rounded-xl bg-lagon-600 px-4 py-3 font-semibold text-white">Connexion par email</Link>
      </div>
    );
  }

  return (
    <div className="card rise w-full max-w-sm space-y-5 p-7">
      <div className="text-center">
        <Logo size={44} />
        {me?.terminal ? <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted">Terminal · {me.terminal.name}</p> : null}
      </div>
      <p className="text-center text-sm text-muted">Saisissez votre PIN personnel</p>
      <div className="flex justify-center gap-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={`h-4 w-4 rounded-full transition ${i < pin.length ? "bg-lagon-500" : i < 4 ? "bg-slate-400/40" : "bg-slate-400/15"}`} />
        ))}
      </div>
      {error ? <p className="rounded-lg bg-red-500/10 px-3 py-2 text-center text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      <NumPad value={pin} onChange={(v) => setPin(v.slice(0, 6))} onSubmit={submit} submitLabel="Entrer" maxLength={6} disabled={loading} />
      <p className="text-center text-sm"><Link href="/login" className="text-lagon-600 hover:underline">Connexion par email</Link></p>
    </div>
  );
}

export default function PosLoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Suspense><PinLogin /></Suspense>
    </main>
  );
}
