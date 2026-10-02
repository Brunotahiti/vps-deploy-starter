/* eslint-disable @next/next/no-img-element -- photos et logo fournis par le restaurant (URL libre) : non optimisables par next/image */
"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Maximize2 } from "lucide-react";
import { api, ApiClientError } from "@/lib/api-client";
import { formatMoney } from "@/lib/money";

type Display = {
  name: string; currency: string; timezone: string; logoUrl: string | null; theme: "lagoon" | "night" | "light"; rotateSeconds: number; showPrices: boolean; showImages: boolean;
  headline: { title: string; text: string | null; price: number | null } | null;
  categories: { id: string; name: string; color: string; products: { id: string; name: string; description: string | null; price: number; imageUrl: string | null; soldOut: boolean }[] }[];
};
const THEMES = {
  lagoon: { page: "bg-gradient-to-br from-[#0f6e6c] via-[#0d8a86] to-[#14aaa3] text-white", card: "bg-white/10 ring-1 ring-white/15", muted: "text-white/70", accent: "text-[#ffd27a]", band: "bg-[#f97c3c] text-white" },
  night: { page: "bg-gradient-to-br from-[#060a17] via-[#0b1730] to-[#0f2a3c] text-white", card: "bg-white/[0.06] ring-1 ring-white/10", muted: "text-white/60", accent: "text-[#5eead4]", band: "bg-[#14aaa3] text-white" },
  light: { page: "bg-[#f6f8fb] text-[#0f172a]", card: "bg-white shadow-[0_6px_24px_-12px_rgba(15,23,42,.25)]", muted: "text-slate-500", accent: "text-[#0d8a86]", band: "bg-[#0d8a86] text-white" },
};
const PER_PAGE = 10; // articles par page (deux colonnes)

/** Carte plein écran pour télévision : pages qui défilent, relue toutes les 30 secondes (prix, épuisés). */
export function MenuScreen({ token }: { token: string }) {
  const q = useQuery({ queryKey: ["screen", token], queryFn: () => api.get<Display>(`/api/public/screens/${token}`), refetchInterval: 30_000, retry: true, retryDelay: 10_000 });
  const [page, setPage] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const [full, setFull] = useState(false);
  // Pages : chaque catégorie, découpée si elle est trop longue
  const pages = useMemo(() => (q.data?.categories ?? []).flatMap((c) => {
    const out = [];
    for (let i = 0; i < c.products.length; i += PER_PAGE) out.push({ category: c, products: c.products.slice(i, i + PER_PAGE), part: c.products.length > PER_PAGE ? Math.floor(i / PER_PAGE) + 1 : 0 });
    return out;
  }), [q.data]);
  const rotate = (q.data?.rotateSeconds ?? 12) * 1000;
  useEffect(() => { const t = setInterval(() => setPage((p) => p + 1), rotate); return () => clearInterval(t); }, [rotate]);
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15_000); return () => clearInterval(t); }, []);
  // L'écran ne se met pas en veille (navigateurs qui le permettent)
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const wl = (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock;
    wl?.request("screen").then((l) => { lock = l; }).catch(() => {});
    return () => { void lock?.release().catch(() => {}); };
  }, []);

  if (q.error && !q.data) {
    const msg = q.error instanceof ApiClientError && q.error.status === 404 ? "Cet écran n'existe plus ou a été désactivé." : q.error instanceof ApiClientError && q.error.code === "OPTION_REQUIRED" ? "L'option « Écrans en salle » n'est pas active." : "Connexion en cours…";
    return <main className="flex h-dvh items-center justify-center bg-[#0b1730] p-8 text-center text-2xl font-bold text-white">{msg}</main>;
  }
  if (!q.data) return <main className="h-dvh bg-[#0b1730]" />;
  const d = q.data, T = THEMES[d.theme] ?? THEMES.lagoon;
  const cur = pages.length ? pages[page % pages.length] : null;
  const price = (n: number) => formatMoney(n, d.currency);
  return (
    <main className={`relative flex h-dvh flex-col overflow-hidden ${T.page}`} data-testid="menu-screen">
      <header className="flex items-center gap-4 px-[3vw] pt-[2.5vh]">
        {d.logoUrl ? <img src={d.logoUrl} alt="" className="h-[7vh] w-[7vh] rounded-2xl object-cover" /> : null}
        <h1 className="text-[4vh] font-extrabold tracking-tight">{d.name}</h1>
        <span className={`ml-auto text-[3.4vh] font-bold tabular-nums ${T.muted}`}>{now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: d.timezone })}</span>
      </header>
      {d.headline ? (
        <div className={`mx-[3vw] mt-[2vh] flex items-center gap-[2vw] rounded-[2vh] px-[2.5vw] py-[1.6vh] ${T.band}`} data-testid="screen-headline">
          <span className="text-[2.2vh] font-extrabold uppercase tracking-[0.15em]">{d.headline.title}</span>
          {d.headline.text ? <span className="text-[3vh] font-bold">{d.headline.text}</span> : null}
          {d.headline.price !== null && d.showPrices ? <span className="ml-auto text-[3.6vh] font-extrabold">{price(d.headline.price)}</span> : null}
        </div>
      ) : null}
      {cur ? (
        <section key={`${cur.category.id}-${cur.part}`} className="rise flex min-h-0 flex-1 flex-col px-[3vw] py-[2.5vh]">
          <h2 className="mb-[2vh] flex items-baseline gap-3 text-[5vh] font-extrabold tracking-tight">
            <span className="inline-block h-[4vh] w-[0.7vh] rounded-full" style={{ background: cur.category.color }} />{cur.category.name}
            {cur.part ? <span className={`text-[2.4vh] font-semibold ${T.muted}`}>({cur.part})</span> : null}
          </h2>
          <ul className="grid min-h-0 flex-1 grid-cols-2 content-start gap-x-[3vw] gap-y-[1.6vh]">
            {cur.products.map((p) => (
              <li key={p.id} className={`flex items-center gap-[1.4vw] rounded-[1.6vh] px-[1.4vw] py-[1.2vh] ${T.card} ${p.soldOut ? "opacity-50" : ""}`} data-testid="screen-item">
                {p.imageUrl ? <img src={p.imageUrl} alt="" className="h-[8vh] w-[8vh] shrink-0 rounded-[1.2vh] object-cover" /> : null}
                <div className="min-w-0 flex-1">
                  <p className={`truncate text-[3vh] font-bold ${p.soldOut ? "line-through" : ""}`}>{p.name}</p>
                  {p.description ? <p className={`truncate text-[1.9vh] ${T.muted}`}>{p.description}</p> : null}
                </div>
                {p.soldOut ? <span className="shrink-0 rounded-full bg-red-600 px-[1vw] py-[0.4vh] text-[1.9vh] font-extrabold uppercase text-white">Épuisé</span>
                  : d.showPrices ? <span className={`shrink-0 text-[3vh] font-extrabold tabular-nums ${T.accent}`}>{price(p.price)}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : <p className="m-auto text-[3vh] font-bold">La carte arrive…</p>}
      {pages.length > 1 ? (
        <footer className="flex justify-center gap-2 pb-[2vh]">{pages.map((_, i) => <span key={i} className={`h-[0.9vh] rounded-full transition-all ${i === page % pages.length ? "w-[3vw] bg-current" : "w-[0.9vh] bg-current opacity-30"}`} />)}</footer>
      ) : null}
      {!full ? <button onClick={() => { void document.documentElement.requestFullscreen?.().catch(() => {}); setFull(true); }} className="absolute bottom-4 right-4 flex items-center gap-2 rounded-full bg-black/40 px-4 py-2 text-sm font-bold text-white backdrop-blur" aria-label="Plein écran"><Maximize2 className="h-4 w-4" />Plein écran</button> : null}
    </main>
  );
}
