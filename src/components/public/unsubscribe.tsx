"use client";

import { useState } from "react";
import { MailX, CheckCircle2 } from "lucide-react";
import { api, ApiClientError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";

export function Unsubscribe({ token }: { token: string }) {
  const [state, setState] = useState<{ done?: string; error?: string; busy?: boolean }>({});
  const go = async () => {
    setState({ busy: true });
    try { const r = await api.post<{ organization: string }>("/api/public/unsubscribe", { token }); setState({ done: r.organization }); }
    catch (e) { setState({ error: e instanceof ApiClientError ? e.message : "Désabonnement impossible : réessayez" }); }
  };
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--bg)] p-6">
      <div className="card w-full max-w-md p-8 text-center">
        {state.done ? (
          <>
            <CheckCircle2 className="mx-auto h-12 w-12 text-green-600" />
            <h1 className="mt-4 text-2xl font-extrabold">C&apos;est fait</h1>
            <p className="mt-2 text-sm text-muted">Vous ne recevrez plus les offres de {state.done} par e-mail. Vous pourrez redonner votre accord sur place à tout moment.</p>
          </>
        ) : (
          <>
            <MailX className="mx-auto h-12 w-12 text-lagon-600" />
            <h1 className="mt-4 text-2xl font-extrabold">Se désabonner</h1>
            <p className="mt-2 text-sm text-muted">Vous ne recevrez plus d&apos;offres par e-mail de ce restaurant.</p>
            {state.error ? <p className="mt-3 text-sm font-semibold text-red-600">{state.error}</p> : null}
            <Button size="lg" className="mt-6 w-full" loading={state.busy} onClick={go} data-testid="unsubscribe-confirm">Confirmer le désabonnement</Button>
          </>
        )}
      </div>
    </main>
  );
}
