"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LogIn, LogOut, Coffee, Play, Clock } from "lucide-react";
import { api, ApiClientError } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { NumPad } from "@/components/ui/numpad";
import { useToast } from "@/components/ui/toast";
import { formatTime } from "@/lib/dates";
import { CLOCK_LABEL, fmtHours, type ClockStatus, type Present } from "@/components/admin/staff-types";

/** Pointeuse : PIN → état de l'employé → ARRIVÉE / PAUSE / REPRISE / DÉPART. */
export function ClockScreen() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { timezone } = useSession();
  const [pin, setPin] = useState("");
  const [status, setStatus] = useState<ClockStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const present = useQuery({ queryKey: ["staff", "present"], queryFn: () => api.get<Present[]>("/api/staff/present"), refetchInterval: 30_000 });
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { if (!status) return; const t = setTimeout(() => { setStatus(null); setPin(""); }, 20_000); return () => clearTimeout(t); }, [status]);

  const identify = async () => {
    if (pin.length < 4) return;
    setLoading(true);
    try { setStatus(await api.post<ClockStatus>("/api/staff/clock/identify", { pin })); }
    catch (e) { toast(e instanceof ApiClientError ? e.message : "Erreur", "error"); setPin(""); }
    finally { setLoading(false); }
  };
  const act = async (kind: string) => {
    setLoading(true);
    try {
      const r = await api.post<ClockStatus & { entry: { at: string } }>("/api/staff/clock", { pin, kind });
      toast(`${CLOCK_LABEL[kind]} enregistré${kind === "CLOCK_IN" ? "e" : ""} · ${r.employee.firstName} · ${formatTime(r.entry.at, timezone)}`, "success");
      qc.invalidateQueries({ queryKey: ["staff"] });
      setStatus(null); setPin("");
    } catch (e) { toast(e instanceof ApiClientError ? e.message : "Erreur", "error"); }
    finally { setLoading(false); }
  };
  const ICON: Record<string, React.ComponentType<{ className?: string }>> = { CLOCK_IN: LogIn, BREAK_START: Coffee, BREAK_END: Play, CLOCK_OUT: LogOut };
  const STYLE: Record<string, string> = { CLOCK_IN: "bg-green-600 text-white", BREAK_START: "bg-orange-500 text-white", BREAK_END: "bg-brand text-white", CLOCK_OUT: "bg-red-600 text-white" };

  return (
    <div className="mx-auto grid max-w-4xl gap-4 p-4 lg:grid-cols-[1fr_300px]">
      <div className="card p-5">
        <div className="mb-4 text-center">
          <p suppressHydrationWarning className="font-mono text-4xl font-extrabold tabular-nums tracking-tight">{now.toLocaleTimeString("fr-FR", { timeZone: timezone, hour: "2-digit", minute: "2-digit", second: "2-digit" })}</p>
          <p suppressHydrationWarning className="text-sm text-muted">{now.toLocaleDateString("fr-FR", { timeZone: timezone, weekday: "long", day: "numeric", month: "long" })}</p>
        </div>
        {!status ? (
          <div className="mx-auto max-w-xs">
            <p className="mb-3 text-center text-sm font-semibold">Saisissez votre PIN pour pointer</p>
            <div className="mb-3 flex justify-center gap-3">{[0, 1, 2, 3, 4, 5].map((i) => <span key={i} className={`h-4 w-4 rounded-full transition ${i < pin.length ? "bg-lagon-500" : i < 4 ? "bg-slate-400/40" : "bg-slate-400/15"}`} />)}</div>
            <NumPad value={pin} onChange={(v) => setPin(v.slice(0, 6))} onSubmit={identify} submitLabel="Valider" maxLength={6} disabled={loading} />
          </div>
        ) : (
          <div className="rise">
            <div className="mb-4 rounded-2xl surface-2 p-4 text-center">
              <p className="text-2xl font-extrabold">{status.employee.firstName} {status.employee.lastName}</p>
              <p className="text-sm text-muted">{status.employee.jobTitle ?? ""}</p>
              <p className={`mt-2 inline-block rounded-full px-3 py-1 text-xs font-bold ${status.state === "IN" ? "bg-green-500/15 text-green-700" : status.state === "BREAK" ? "bg-orange-500/15 text-orange-700" : "bg-slate-500/15 text-slate-600"}`}>{status.state === "IN" ? `En service · ${fmtHours(status.workedMs / 3600000)} aujourd'hui` : status.state === "BREAK" ? `En pause · ${fmtHours(status.breakMs / 3600000)}` : "Hors service"}</p>
            </div>
            <div className={`grid gap-3 ${status.allowed.length > 1 ? "sm:grid-cols-2" : ""}`}>
              {status.allowed.map((k) => { const I = ICON[k]; return <button key={k} disabled={loading} onClick={() => act(k)} className={`touch flex h-24 flex-col items-center justify-center gap-1 rounded-2xl text-lg font-extrabold uppercase tracking-wide shadow-lift transition active:scale-[0.98] disabled:opacity-60 ${STYLE[k]}`}><I className="h-7 w-7" />{CLOCK_LABEL[k]}</button>; })}
            </div>
            <button onClick={() => { setStatus(null); setPin(""); }} className="mt-4 w-full text-center text-sm font-semibold text-muted">Annuler</button>
            {status.entries.length ? <p className="mt-3 text-center text-xs text-muted">Aujourd&apos;hui : {status.entries.map((e) => `${CLOCK_LABEL[e.kind]} ${formatTime(e.at, timezone)}`).join(" · ")}</p> : null}
          </div>
        )}
      </div>
      <div className="card p-4">
        <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted"><Clock className="h-4 w-4" />Présents</p>
        {present.data?.length === 0 ? <p className="text-sm text-muted">Personne n&apos;est pointé.</p> : null}
        <ul className="space-y-1.5">{present.data?.map((p) => <li key={p.id} className="flex items-center justify-between rounded-lg surface-2 px-3 py-2 text-sm"><span><span className="font-semibold">{p.firstName}</span><span className="block text-xs text-muted">{p.jobTitle ?? ""}{p.since ? ` · depuis ${formatTime(p.since, timezone)}` : ""}</span></span><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${p.state === "BREAK" ? "bg-orange-500/15 text-orange-700" : "bg-green-500/15 text-green-700"}`}>{p.state === "BREAK" ? "pause" : fmtHours(p.workedMs / 3600000)}</span></li>)}</ul>
      </div>
    </div>
  );
}
