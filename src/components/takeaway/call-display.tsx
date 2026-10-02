"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Maximize2, Volume2, VolumeX } from "lucide-react";
import { api } from "@/lib/api-client";
import { formatTime } from "@/lib/dates";
import { useSession } from "@/hooks/use-session";

type Display = { establishment: string; preparing: string[]; ready: { call: string; readyAt: string | null }[] };

/** Petit carillon (deux notes) joué quand un numéro passe « prêt » ; le navigateur exige un geste pour l'activer. */
function chime(ctx: AudioContext) {
  const t = ctx.currentTime;
  [[880, 0], [1320, 0.18]].forEach(([f, d]) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine"; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.35, t + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.9);
    o.connect(g).connect(ctx.destination); o.start(t + d); o.stop(t + d + 1);
  });
}

/**
 * Écran d'appel des numéros, à afficher dans la salle (télévision, tablette) : « En préparation » et « C'est prêt ! ».
 * Seulement des numéros : jamais de nom ni de téléphone à l'écran.
 */
export function CallDisplay() {
  const { timezone } = useSession();
  const q = useQuery({ queryKey: ["takeaway", "display"], queryFn: () => api.get<Display>("/api/takeaway/display"), refetchInterval: 4000 });
  const [sound, setSound] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const audio = useRef<AudioContext | null>(null);
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 10_000); return () => clearInterval(t); }, []);

  // Nouveau numéro prêt : carillon (si le son est activé)
  const readyKey = q.data?.ready.map((r) => r.call).join(",") ?? "";
  useEffect(() => {
    if (!q.data) return;
    const current = new Set(q.data.ready.map((r) => r.call));
    const fresh = seen.current ? [...current].some((c) => !seen.current!.has(c)) : false;
    seen.current = current;
    if (fresh && sound && audio.current) chime(audio.current);
  }, [readyKey, q.data, sound]);

  const toggleSound = () => {
    if (!audio.current) audio.current = new AudioContext();
    if (!sound) { void audio.current.resume(); chime(audio.current); }
    setSound(!sound);
  };
  const d = q.data;
  const fresh = (iso: string | null) => !!iso && now - new Date(iso).getTime() < 90_000;

  return (
    <div className="flex h-dvh flex-col bg-[radial-gradient(1200px_600px_at_80%_-10%,rgba(20,170,163,.35),transparent),linear-gradient(160deg,#0b1222,#0f1d33)] text-white" data-testid="call-display">
      <header className="flex items-center gap-3 px-6 py-4">
        <p className="mr-auto text-xl font-extrabold tracking-tight sm:text-2xl">{d?.establishment ?? "…"}</p>
        <p className="text-2xl font-black tabular-nums text-white/80">{formatTime(new Date(now), timezone)}</p>
        <button onClick={toggleSound} className="flex h-11 items-center gap-2 rounded-xl bg-white/10 px-3 text-sm font-semibold hover:bg-white/20" aria-pressed={sound}>{sound ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}<span className="hidden sm:inline">{sound ? "Son activé" : "Activer le son"}</span></button>
        <button onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})} className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 hover:bg-white/20" aria-label="Plein écran"><Maximize2 className="h-5 w-5" /></button>
      </header>
      <main className="grid min-h-0 flex-1 gap-4 px-6 pb-6 md:grid-cols-[2fr_3fr]">
        <section className="flex min-h-0 flex-col rounded-3xl bg-white/5 p-5 ring-1 ring-white/10">
          <h2 className="mb-4 text-2xl font-extrabold text-orange-300 sm:text-3xl">👨‍🍳 En préparation</h2>
          <div className="flex flex-wrap content-start gap-3 overflow-hidden" data-testid="call-preparing">
            {d?.preparing.length ? d.preparing.map((c) => <span key={c} className="rounded-2xl bg-white/10 px-5 py-3 text-4xl font-black tabular-nums text-white/85 sm:text-5xl">{c}</span>) : <p className="text-lg text-white/50">—</p>}
          </div>
        </section>
        <section className="flex min-h-0 flex-col rounded-3xl bg-emerald-500/15 p-5 ring-1 ring-emerald-300/30">
          <h2 className="mb-4 text-2xl font-extrabold text-emerald-300 sm:text-3xl">🎉 C&apos;est prêt !</h2>
          <div className="flex flex-wrap content-start gap-4 overflow-hidden" data-testid="call-ready">
            {d?.ready.length ? d.ready.map((r) => (
              <span key={r.call} className={`rounded-3xl bg-emerald-500 px-7 py-4 text-6xl font-black tabular-nums text-white shadow-[0_20px_50px_-15px_rgba(16,185,129,.8)] sm:text-7xl ${fresh(r.readyAt) ? "animate-pulse" : ""}`}>{r.call}</span>
            )) : <p className="text-lg text-white/50">Votre numéro s&apos;affichera ici dès que votre commande sera prête.</p>}
          </div>
        </section>
      </main>
    </div>
  );
}
