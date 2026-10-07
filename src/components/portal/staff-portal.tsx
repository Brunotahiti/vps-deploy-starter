"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Delete, Mail } from "lucide-react";
import { api, ApiClientError } from "@/lib/api-client";
import { safeNext } from "@/lib/safe-next";
import { useSession } from "@/hooks/use-session";
import { Logo } from "@/components/brand";
import { WelcomeSplash } from "@/components/welcome-splash";
import { InstallAppButton } from "@/components/install-app";
import { PORTALS, rememberPortal, type PortalMode } from "./portals";
import { setActivePass, syncOfflinePasses, unlockWithPin } from "@/lib/offline/passes";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "⌫"] as const;
type Member = { id: string; name: string; initials: string; color: string | null; roleKey: string | null; roleName: string | null };
const ROLE_SHORT: Record<string, string> = { owner: "Propriétaire", admin: "Admin", manager: "Gérant", kitchen: "Cuisine", server: "Salle", cashier: "Caisse", bartender: "Bar", accountant: "Compta" };

/** Horloge rendue après le montage pour éviter tout écart entre serveur et navigateur. */
function useClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/**
 * Portail du personnel (salle, caisse ou cuisine) : grande horloge lisible de loin, PIN sur un pavé large,
 * saisie au clavier physique, passage d'un portail à l'autre, puis entrée directe sur l'écran de l'équipe.
 */
export function StaffPortal({ mode }: { mode: PortalMode }) {
  const cfg = PORTALS[mode];
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const { me, can, isLoading } = useSession();
  const now = useClock();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [loading, setLoading] = useState(false);
  const [welcome, setWelcome] = useState<string | null>(null);
  // Équipe de l'établissement : on touche son nom, puis on tape son PIN (plus rapide, et jamais d'ambiguïté de PIN)
  const [member, setMember] = useState<Member | null>(null);
  const team = useQuery({ queryKey: ["pin-team"], queryFn: () => api.get<Member[]>("/api/auth/pin/team"), enabled: !!me?.terminal, staleTime: 60_000, retry: false });
  const members = team.data ?? [];
  const next = safeNext(params.get("next"), cfg.next);

  // Laissez-passer à jour pour une prochaine coupure
  useEffect(() => { syncOfflinePasses().catch(() => {}); }, []);

  // Déjà connecté avec l'accès de ce portail : directement à l'écran de l'équipe
  useEffect(() => {
    if (!welcome && me?.user && can(cfg.permission)) router.replace(next);
  }, [me?.user, can, cfg.permission, next, router, welcome]);

  const submit = useCallback(async () => {
    if (pin.length < 4 || loading) return;
    setLoading(true);
    setError(null);
    try {
      let u: { firstName: string; displayName?: string | null };
      try {
        u = await api.post<{ firstName: string; displayName?: string | null }>("/api/auth/pin", { pin, ...(member ? { userId: member.id } : {}) });
        // Laissez-passer de l'employé (opérations hors ligne signées à son nom), sans retarder l'entrée
        syncOfflinePasses(true).then(() => unlockWithPin(pin)).then((p) => setActivePass(p ? { ...p, mode: "online" } : null)).catch(() => {});
      } catch (err) {
        if (!(err instanceof ApiClientError && err.isNetwork)) throw err;
        // Pas d'internet : le PIN ouvre le laissez-passer gardé sur la tablette
        const p = await unlockWithPin(pin);
        if (!p) throw new ApiClientError(401, "INVALID_PIN", "PIN incorrect (hors ligne : seuls les employés déjà connectés une fois sur cette tablette peuvent entrer)");
        await setActivePass({ ...p, mode: "offline" });
        u = p;
      }
      rememberPortal(mode);
      router.prefetch(next);
      setWelcome(u.displayName || u.firstName);
      await qc.invalidateQueries();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : err instanceof Error ? err.message : "Connexion impossible, réessayez");
      setShake((n) => n + 1);
      setPin("");
      setLoading(false);
    }
  }, [pin, loading, mode, next, qc, router, member]);

  const press = useCallback((k: string) => {
    if (loading) return;
    setError(null);
    if (k === "⌫") setPin((p) => p.slice(0, -1));
    else if (k === "C") setPin("");
    else setPin((p) => (p.length >= 6 ? p : p + k));
  }, [loading]);

  // Clavier physique : chiffres, retour arrière, Échap, Entrée
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") press("⌫");
      else if (e.key === "Escape") press("C");
      else if (e.key === "Enter") submit();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [press, submit]);

  if (welcome !== null) return <WelcomeSplash name={welcome} onDone={() => router.replace(next)} />;

  const registered = !!me?.terminal;
  const Icon = cfg.icon;
  const hh = now ? String(now.getHours()).padStart(2, "0") : "--";
  const mm = now ? String(now.getMinutes()).padStart(2, "0") : "--";
  const date = now ? now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }) : "";
  const emailLogin = `/login?next=${encodeURIComponent(next)}`;

  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden bg-nuit-950 text-white" data-testid={`portal-${mode}`}>
      {/* Décor : lueur aux couleurs de l'équipe, lueur lagon, trame de points */}
      <span aria-hidden className={`pointer-events-none absolute -right-32 -top-40 h-[34rem] w-[34rem] rounded-full blur-[120px] ${cfg.glow}`} />
      <span aria-hidden className="pointer-events-none absolute -bottom-48 -left-40 h-[36rem] w-[36rem] rounded-full bg-lagon-500/15 blur-[120px]" />
      <span aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "radial-gradient(rgb(255 255 255) 1px, transparent 1px)", backgroundSize: "22px 22px" }} />

      <header className="relative z-10 flex items-center justify-between gap-3 px-4 pt-4 sm:px-8 sm:pt-6">
        <Logo size={34} light className="[&>span]:hidden sm:[&>span]:inline" />
        {registered ? (
          <nav aria-label="Choisir le portail" className="flex rounded-full bg-white/[0.07] p-1 ring-1 ring-white/10">
            {(Object.keys(PORTALS) as PortalMode[]).map((m) => {
              const p = PORTALS[m];
              const TabIcon = p.icon;
              const active = m === mode;
              return (
                <Link key={m} href={p.path} replace onClick={() => rememberPortal(m)} aria-current={active ? "page" : undefined} className={`touch flex h-10 items-center gap-1.5 rounded-full px-3.5 text-sm font-bold transition ${active ? `${p.tab} text-white shadow-lg` : "text-white/60 hover:text-white"}`}>
                  <TabIcon className="h-4 w-4" />{p.label}
                </Link>
              );
            })}
          </nav>
        ) : null}
      </header>

      <div className="relative z-10 mx-auto grid w-full max-w-6xl flex-1 items-center gap-6 px-4 py-6 sm:px-8 lg:grid-cols-[1.15fr_1fr] lg:gap-14">
        <section className="brand-rise text-center lg:text-left">
          <p className={`text-sm font-semibold uppercase tracking-[0.2em] ${cfg.accentText}`}>{me?.terminal?.establishmentName ?? cfg.label}</p>
          <p className="mt-3 font-mono text-6xl font-extrabold leading-none tracking-tight tabular-nums sm:text-8xl lg:text-[8.5rem]" aria-label={now ? `Il est ${hh} heures ${mm}` : undefined}>
            {hh}<span className={`animate-pulse ${cfg.accentText}`}>:</span>{mm}
          </p>
          <p className="mt-3 text-lg font-semibold text-white/70 first-letter:uppercase sm:text-xl">{date}</p>
          <h1 className="mt-5 text-2xl font-extrabold tracking-tight sm:text-3xl">{now ? `${cfg.greeting(now.getHours())} !` : "Ia ora na !"}</h1>
          <ul className="mx-auto mt-6 hidden max-w-md space-y-3 text-left text-white/75 sm:block lg:mx-0">
            {cfg.features.map((f) => (
              <li key={f.text} className="flex items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.07] ring-1 ring-white/10"><f.icon className={`h-[18px] w-[18px] ${f.tone}`} /></span>{f.text}</li>
            ))}
          </ul>
        </section>

        <section className="brand-rise mx-auto w-full max-w-sm" style={{ animationDelay: "120ms" }}>
          {!isLoading && !registered ? (
            <div className="rounded-[28px] bg-white/[0.06] p-7 text-center ring-1 ring-white/10 backdrop-blur-xl">
              <span className={`mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${cfg.tile}`}><Icon className="h-7 w-7" /></span>
              <h2 className="mt-4 text-xl font-extrabold">Appareil non enregistré</h2>
              <p className="mt-2 text-sm leading-relaxed text-white/70">Pour utiliser cet appareil avec un PIN, un manager se connecte une première fois avec son e-mail, puis l&apos;enregistre comme terminal <strong className="text-white">{cfg.terminalKind}</strong> dans Administration → Paramètres → Terminaux.</p>
              <Link href={emailLogin} className={`touch mt-6 flex h-14 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r font-bold text-white ${cfg.button}`}><Mail className="h-5 w-5" />Connexion par e-mail</Link>
            </div>
          ) : (
            <div key={shake} className={`rounded-[28px] bg-white/[0.06] p-5 ring-1 ring-white/10 backdrop-blur-xl sm:p-7 ${shake ? "shake" : ""}`}>
              <div className="flex items-center gap-3">
                {member ? (
                  <>
                    <button type="button" onClick={() => { setMember(null); setPin(""); setError(null); }} className="touch flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/[0.07] ring-1 ring-white/10" aria-label="Choisir une autre personne"><ChevronLeft className="h-6 w-6" /></button>
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-base font-extrabold text-white shadow-lg" style={{ background: member.color ?? "#0ea5a4" }}>{member.initials}</span>
                    <div className="min-w-0">
                      <h2 className="truncate text-lg font-extrabold leading-tight" data-testid="pin-member-name">{member.name}</h2>
                      <p className="truncate text-sm text-white/60">Votre PIN, puis {cfg.submit.toLowerCase()}</p>
                    </div>
                  </>
                ) : (
                  <>
                    <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${cfg.tile}`}><Icon className="h-6 w-6" /></span>
                    <div className="min-w-0">
                      <h2 className="text-lg font-extrabold leading-tight">{cfg.title}</h2>
                      <p className="truncate text-sm text-white/60">{members.length > 1 ? "Touchez votre nom, puis votre PIN" : me?.terminal ? `Terminal · ${me.terminal.name}` : "Saisissez votre PIN"}</p>
                    </div>
                  </>
                )}
              </div>
              {members.length > 1 && !member ? (
                <div className="-mx-1 mt-4 flex gap-2 overflow-x-auto px-1 pb-1" data-testid="pin-team">
                  {members.map((m) => (
                    <button key={m.id} type="button" onClick={() => { setMember(m); setPin(""); setError(null); }} className="touch flex w-[4.75rem] shrink-0 flex-col items-center gap-1.5 rounded-2xl bg-white/[0.07] px-1 py-2.5 ring-1 ring-white/10 transition hover:bg-white/[0.12] active:scale-95" data-testid="pin-member" title={m.roleKey ? ROLE_SHORT[m.roleKey] ?? m.roleName ?? undefined : undefined}>
                      <span className="flex h-11 w-11 items-center justify-center rounded-full text-sm font-extrabold text-white shadow-lg" style={{ background: m.color ?? "#0ea5a4" }}>{m.initials}</span>
                      <span className="w-full truncate text-center text-xs font-bold">{m.name}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="mt-6 flex justify-center gap-3" aria-label={`${pin.length} chiffre${pin.length > 1 ? "s" : ""} saisi${pin.length > 1 ? "s" : ""}`} role="status">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <span key={i} className={`h-4 w-4 rounded-full transition-all duration-200 ${i < pin.length ? `scale-110 ${cfg.dot}` : i < 4 ? "bg-white/25" : "bg-white/10"}`} />
                ))}
              </div>
              <p className={`mt-3 min-h-5 text-center text-sm font-semibold ${error ? "text-red-300" : "text-white/50"}`} role={error ? "alert" : undefined}>{error ?? "PIN personnel de 4 à 6 chiffres"}</p>

              <div className="mt-4 grid grid-cols-3 gap-2.5">
                {KEYS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    disabled={loading}
                    onClick={() => press(k)}
                    aria-label={k === "⌫" ? "Effacer le dernier chiffre" : k === "C" ? "Tout effacer" : k}
                    className={`touch flex h-16 items-center justify-center rounded-2xl text-2xl font-bold ring-1 transition active:scale-95 disabled:opacity-50 sm:h-[4.5rem] ${k === "C" ? "bg-red-500/10 text-red-300 ring-red-400/20 hover:bg-red-500/15" : "bg-white/[0.07] ring-white/10 hover:bg-white/[0.12] active:bg-white/20"}`}
                  >
                    {k === "⌫" ? <Delete className="h-7 w-7" /> : k}
                  </button>
                ))}
              </div>
              <button type="button" onClick={submit} disabled={pin.length < 4 || loading} className={`touch mt-3 flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r text-lg font-extrabold tracking-wide text-white transition active:scale-[0.98] disabled:opacity-40 disabled:shadow-none ${cfg.button}`}>
                {loading ? "Connexion…" : cfg.submit}
              </button>
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-3 text-sm font-semibold text-white/60">
            {registered ? <Link href={emailLogin} className="inline-flex items-center gap-1.5 hover:text-white"><Mail className="h-4 w-4" />Connexion par e-mail</Link> : null}
            <InstallAppButton variant="outline" className="h-10 rounded-xl border-white/15 bg-white/[0.05] px-3 text-sm text-white/80 hover:bg-white/10" label="Installer l'application" compact />
          </div>
        </section>
      </div>
    </main>
  );
}
