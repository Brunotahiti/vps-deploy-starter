"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Eye, Globe, LogIn, Monitor, MousePointerClick, PlayCircle, Smartphone, Tablet, UserPlus, Users } from "lucide-react";
import { api } from "@/lib/api-client";
import { formatDateTime } from "@/lib/dates";
import { ChartCard, ColumnChart, HBars, Stat, StackedBar } from "@/components/admin/charts";
import { Spinner } from "@/components/ui/misc";
import type { TrafficStats } from "@/server/services/site-traffic";

/*
 * Fréquentation : visites du site vitrine (mesure anonyme sans cookie) et connexions à l'application.
 * Toutes les heures sont celles de Tahiti.
 */

const PERIODS = [7, 30, 90] as const;
const WEEKDAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const PAGE_LABEL: Record<string, string> = { "/": "Accueil", "/demo": "Démo en live", "/conditions": "Conditions générales", "/mentions-legales": "Mentions légales", "/confidentialite": "Confidentialité",
  "/logiciel-caisse-restaurant-tahiti": "Page Restaurant", "/logiciel-caisse-roulotte-tahiti": "Page Roulotte", "/logiciel-caisse-snack-tahiti": "Page Snack",
  "/logiciel-caisse-bar-tahiti": "Page Bar", "/commande-en-ligne-restaurant-tahiti": "Page Commande en ligne", "/gestion-restaurant-polynesie": "Page Gestion" };
const CLICK_LABEL: Record<string, string> = {
  cta_trial: "« Essayer gratuitement »", cta_demo: "« Demander une démonstration »", cta_demo_submit: "Envoi du formulaire de démo",
  demo_form_start: "Formulaire de démo commencé", demo_form_submit: "Demande de démo envoyée",
  cta_live: "« Voir ManaResto en live »", cta_live_bottom: "« Voir en live » (bas de page)", nav_login: "« Se connecter »", whatsapp: "WhatsApp",
};
const METHOD_LABEL: Record<string, string> = { password: "E-mail et mot de passe", pin: "Code PIN (caisse)", invite: "Invitation acceptée", offline: "Retour du réseau", box: "Boîtier local" };
const DEVICE_LABEL: Record<string, string> = { mobile: "Téléphone", tablet: "Tablette", desktop: "Ordinateur" };
const DEVICE_ICON = { mobile: Smartphone, tablet: Tablet, desktop: Monitor } as const;

const n = (v: number) => v.toLocaleString("fr-FR");
const plural = (v: number, one: string, many = `${one}s`) => `${n(v)} ${v > 1 ? many : one}`;
// Écart affiché seulement si la période précédente est assez fournie pour qu'il ait un sens
const evolution = (cur: number, prev: number) => (prev >= 10 ? ((cur - prev) / prev) * 100 : null);
const shortDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });
const tinyDay = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`;
const hourLabel = (h: number) => `${h} h`;

export function TrafficPanel() {
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const q = useQuery({ queryKey: ["platform-traffic", days], queryFn: () => api.get<TrafficStats>(`/api/platform/traffic?days=${days}`), refetchInterval: 60_000 });
  const t = q.data;
  const vs = `vs ${days} j préc.`;

  return (
    <section className="space-y-4" aria-labelledby="traffic-title" data-testid="traffic">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="traffic-title" className="flex items-center gap-2 text-lg font-extrabold tracking-tight"><Globe className="h-5 w-5 text-lagon-600" />Fréquentation</h2>
          <p className="text-xs text-muted">Site www.manaresto.com (mesure anonyme, sans cookie) et connexions à l&apos;application · heures de Tahiti</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {t ? <LivePill visitors={t.live.visitors} logins={t.live.logins} /> : null}
          <div className="inline-flex rounded-xl surface-2 p-1" role="group" aria-label="Période">
            {PERIODS.map((p) => <button key={p} onClick={() => setDays(p)} aria-pressed={days === p} className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${days === p ? "bg-brand text-white shadow-sm" : "text-muted hover:text-[var(--text)]"}`}>{p} jours</button>)}
          </div>
        </div>
      </div>

      {!t ? <div className="card flex justify-center py-12">{q.error ? <p className="text-sm text-red-600">Statistiques indisponibles pour le moment.</p> : <Spinner />}</div> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="Visites du site" value={n(t.totals.visits)} icon={<Users className="h-4 w-4" />} delta={evolution(t.totals.visits, t.previous.visits)} deltaSuffix={vs} hint="1 visiteur compté une fois par jour" />
            <Stat label="Pages vues" value={n(t.totals.views)} icon={<Eye className="h-4 w-4" />} accent="#2a78d6" delta={evolution(t.totals.views, t.previous.views)} deltaSuffix={vs} hint={t.totals.visits ? `${(t.totals.views / t.totals.visits).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} par visite` : "—"} />
            <Stat label="Clics vers l'appli" value={n(t.totals.clicks)} icon={<MousePointerClick className="h-4 w-4" />} accent="#eda100" hint={t.totals.visits ? `${pct(t.totals.clicks, t.totals.visits)} des visites` : "boutons du site"} />
            <Stat label="Connexions" value={n(t.totals.logins)} icon={<LogIn className="h-4 w-4" />} accent="#4a3aa7" delta={evolution(t.totals.logins, t.previous.logins)} deltaSuffix={vs} hint={plural(t.totals.activeUsers, "utilisateur")} />
            <Stat label="Inscriptions" value={n(t.totals.signups)} icon={<UserPlus className="h-4 w-4" />} accent="#16a34a" hint={t.totals.visits ? `conversion ${pct(t.totals.signups, t.totals.visits)}` : `période précédente : ${t.previous.signups}`} />
            <Stat label="Visites de la démo" value={n(t.totals.demos)} icon={<PlayCircle className="h-4 w-4" />} accent="#e87ba4" delta={evolution(t.totals.demos, t.previous.demos)} deltaSuffix={vs} hint="restaurant exemple ouvert" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Visites par jour" subtitle={`Visiteurs différents chaque jour · ${days} derniers jours`} table={{ head: ["Jour", "Visites", "Pages vues"], rows: t.series.days.map((d, i) => [shortDay(d), t.series.visits[i], t.series.views[i]]) }}>
              <ColumnChart data={t.series.days.map((d, i) => ({ label: days > 7 ? tinyDay(d) : shortDay(d), value: t.series.visits[i], sub: plural(t.series.views[i], "page vue", "pages vues") }))} valueLabel={(v) => plural(v, "visite")} height={200} />
            </ChartCard>
            <ChartCard title="Connexions par jour" subtitle={`Ouvertures de session dans l'application · ${days} derniers jours`} table={{ head: ["Jour", "Connexions", "Inscriptions", "Démo"], rows: t.series.days.map((d, i) => [shortDay(d), t.series.logins[i], t.series.signups[i], t.series.demos[i]]) }}>
              <ColumnChart data={t.series.days.map((d, i) => ({ label: days > 7 ? tinyDay(d) : shortDay(d), value: t.series.logins[i], sub: [t.series.signups[i] ? plural(t.series.signups[i], "inscription") : "", t.series.demos[i] ? plural(t.series.demos[i], "visite démo", "visites démo") : ""].filter(Boolean).join(" · ") || undefined }))} valueLabel={(v) => plural(v, "connexion")} height={200} color="var(--viz-3)" />
            </ChartCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-5">
            <ChartCard className="lg:col-span-3" title="Quand vient-on sur le site ?" subtitle="Pages vues par jour de la semaine et par heure" table={{ head: ["Jour", ...Array.from({ length: 24 }, (_, h) => hourLabel(h))], rows: t.viewGrid.map((r, d) => [WEEKDAYS[d], ...r]) }}>
              <Heatmap grid={t.viewGrid} />
            </ChartCard>
            <ChartCard className="lg:col-span-2" title="Connexions selon l'heure" subtitle="À quelle heure les restaurants ouvrent l'application" table={{ head: ["Heure", "Connexions"], rows: t.loginHours.map((v, h) => [hourLabel(h), v]) }}>
              <ColumnChart data={t.loginHours.map((v, h) => ({ label: hourLabel(h), value: v }))} valueLabel={(v) => plural(v, "connexion")} height={200} color="var(--viz-3)" />
            </ChartCard>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <ChartCard title="Pages les plus vues" table={{ head: ["Page", "Vues"], rows: t.pages.map((p) => [pageName(p.k), p.n]) }}>
              <HBars data={t.pages.map((p) => ({ label: pageName(p.k), value: p.n }))} valueLabel={n} />
            </ChartCard>
            <ChartCard title="D'où viennent les visiteurs" subtitle="Site d'origine" table={{ head: ["Origine", "Vues"], rows: t.referrers.map((r) => [r.k ?? "Accès direct", r.n]) }}>
              <HBars data={t.referrers.map((r) => ({ label: r.k ?? "Accès direct ou favori", value: r.n }))} valueLabel={n} color="var(--viz-6)" />
            </ChartCard>
            <ChartCard title="Boutons cliqués" subtitle="Ce qui donne envie d'essayer" table={{ head: ["Bouton", "Clics"], rows: t.clicks.map((c) => [clickName(c.k), c.n]) }}>
              <HBars data={t.clicks.map((c) => ({ label: clickName(c.k), value: c.n }))} valueLabel={n} color="var(--viz-4)" />
            </ChartCard>
            <ChartCard title="Du site à l'inscription" subtitle={`${days} derniers jours`}>
              <HBars data={[
                { label: "Visites du site", value: t.totals.visits },
                { label: "Clics « Essayer gratuitement »", value: t.clicks.find((c) => c.k === "cta_trial")?.n ?? 0 },
                { label: "Visites de la démo", value: t.totals.demos },
                { label: "Inscriptions", value: t.totals.signups },
              ]} valueLabel={n} max={Math.max(1, t.totals.visits)} color="var(--viz-good)" />
            </ChartCard>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <ChartCard title="Appareils" subtitle="Pages vues du site · connexions à l'application">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted">Site</p>
              <StackedBar data={t.devices.map((d) => ({ label: DEVICE_LABEL[d.k ?? ""] ?? "Autre", value: d.n }))} valueLabel={n} />
              <p className="mb-2 mt-4 text-[11px] font-bold uppercase tracking-wider text-muted">Application</p>
              <StackedBar data={t.loginDevices.filter((d) => d.k).map((d) => ({ label: DEVICE_LABEL[d.k ?? ""] ?? "Autre", value: d.n }))} valueLabel={n} />
            </ChartCard>
            <ChartCard title="Modes de connexion" subtitle="Nombre de connexions" table={{ head: ["Mode", "Connexions"], rows: t.loginMethods.map((m) => [METHOD_LABEL[m.k ?? ""] ?? "Autre", m.n]) }}>
              <StackedBar data={t.loginMethods.map((m) => ({ label: METHOD_LABEL[m.k ?? ""] ?? "Autre", value: m.n }))} valueLabel={n} />
              {t.utm.some((u) => u.k) ? (
                <div className="mt-5">
                  <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted">Campagnes (utm_source)</p>
                  <HBars data={t.utm.filter((u) => u.k).map((u) => ({ label: u.k as string, value: u.n }))} valueLabel={(v) => plural(v, "vue")} color="var(--viz-5)" />
                </div>
              ) : null}
            </ChartCard>
            <ChartCard title="Restaurants les plus connectés" subtitle="Hors restaurant exemple" table={{ head: ["Restaurant", "Connexions", "Utilisateurs"], rows: t.topOrgs.map((o) => [o.name, o.n, o.users]) }}>
              <HBars data={t.topOrgs.map((o) => ({ label: o.name, value: o.n, hint: plural(o.users, "personne") }))} valueLabel={(v) => plural(v, "connexion")} color="var(--viz-3)" />
            </ChartCard>
          </div>

          <div className="card p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-extrabold"><LogIn className="h-4 w-4 text-lagon-600" />Connexions et inscriptions récentes</h3>
            {t.recent.length === 0 ? <p className="py-6 text-center text-sm text-muted">Aucune connexion enregistrée pour l&apos;instant.</p> : (
              <ul className="grid gap-x-6 divide-y divide-[var(--border)] md:grid-cols-2 md:divide-y-0">
                {t.recent.map((r, i) => {
                  const Icon = DEVICE_ICON[(r.device ?? "desktop") as keyof typeof DEVICE_ICON] ?? Monitor;
                  return (
                    <li key={i} className="flex items-center gap-3 py-2 text-sm md:border-b md:border-line">
                      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${r.kind === "signup" ? "bg-green-500/12 text-green-600" : "bg-[var(--viz-3)]/12 text-[var(--viz-3)]"}`}>{r.kind === "signup" ? <UserPlus className="h-4 w-4" /> : <Icon className="h-4 w-4" />}</span>
                      <span className="min-w-0 flex-1"><b className="block truncate">{r.user ?? "Utilisateur supprimé"}</b><span className="block truncate text-xs text-muted">{r.organization ?? "—"} · {r.kind === "signup" ? "Inscription" : METHOD_LABEL[r.method ?? ""] ?? "Connexion"}</span></span>
                      <span className="shrink-0 text-xs tabular-nums text-muted">{formatDateTime(r.at)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function pct(a: number, b: number) {
  return `${((a / b) * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
}
function pageName(path: string | null) {
  return path ? PAGE_LABEL[path] ?? path : "—";
}
function clickName(name: string | null) {
  return name ? CLICK_LABEL[name] ?? name : "—";
}

function LivePill({ visitors, logins }: { visitors: number; logins: number }) {
  const on = visitors + logins > 0;
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-line surface px-3 py-1.5 text-xs font-semibold" title="Activité des 30 dernières minutes" data-testid="traffic-live">
      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${on ? "live-dot bg-[var(--viz-good)]" : "bg-[var(--viz-axis)]"}`} />
      {on ? <>{plural(visitors, "visiteur")} · {plural(logins, "connexion")}<span className="font-normal text-muted">en 30 min</span></> : <span className="text-muted">Personne en ce moment</span>}
    </span>
  );
}

/** Carte de chaleur jour × heure : une seule teinte, plus foncée quand il y a plus de visites ; survol avec le détail. */
function Heatmap({ grid }: { grid: number[][] }) {
  const [hover, setHover] = useState<{ d: number; h: number } | null>(null);
  const max = Math.max(0, ...grid.flat());
  if (max === 0) return <p className="py-10 text-center text-sm text-muted">Aucune visite sur la période. Les premières apparaîtront ici dès qu&apos;un visiteur ouvre le site.</p>;
  const level = (v: number) => (v === 0 ? 0 : Math.min(5, Math.ceil((v / max) * 5)));
  const fill = ["var(--viz-grid)", "color-mix(in srgb, var(--viz-1) 22%, var(--surface))", "color-mix(in srgb, var(--viz-1) 42%, var(--surface))", "color-mix(in srgb, var(--viz-1) 62%, var(--surface))", "color-mix(in srgb, var(--viz-1) 82%, var(--surface))", "var(--viz-1)"];
  const total = (d: number) => grid[d].reduce((a, v) => a + v, 0);
  const best = grid.flatMap((r, d) => r.map((v, h) => ({ v, d, h }))).sort((a, b) => b.v - a.v)[0];
  return (
    <div>
      <div className="overflow-x-auto">
        <div className="min-w-[560px]">
          <div className="grid gap-[2px]" style={{ gridTemplateColumns: "64px repeat(24, minmax(0, 1fr))" }}>
            {grid.map((row, d) => (
              <div key={d} className="contents">
                <span className="pr-2 text-right text-[11px] font-semibold leading-5 text-muted">{WEEKDAYS[d].slice(0, 3)}.</span>
                {row.map((v, h) => {
                  const active = hover?.d === d && hover.h === h;
                  return (
                    <span key={h} className="relative h-5 rounded-[4px] transition-[filter] duration-100" style={{ background: fill[level(v)], outline: active ? "2px solid var(--text)" : undefined, outlineOffset: -1 }} onPointerEnter={() => setHover({ d, h })} onPointerLeave={() => setHover(null)} aria-label={`${WEEKDAYS[d]} ${hourLabel(h)} : ${plural(v, "page vue", "pages vues")}`}>
                      {active ? (
                        <span className={`pointer-events-none absolute z-20 whitespace-nowrap rounded-xl border border-line surface px-3 py-2 text-xs shadow-lift ${h > 14 ? "right-0" : "left-0"} ${d > 3 ? "bottom-6" : "top-6"}`} role="tooltip">
                          <b className="text-sm">{plural(v, "page vue", "pages vues")}</b><span className="ml-2 text-muted">{WEEKDAYS[d]} · {hourLabel(h)}–{hourLabel((h + 1) % 24)}</span>
                          <span className="block text-muted">{total(d) ? `${Math.round((v / total(d)) * 100)} % de la journée` : ""}</span>
                        </span>
                      ) : null}
                    </span>
                  );
                })}
              </div>
            ))}
            <span />
            {Array.from({ length: 24 }, (_, h) => <span key={h} className="text-center text-[10px] tabular-nums text-muted">{h % 3 === 0 ? h : ""}</span>)}
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
        <span>Pic : <b className="text-[var(--text)]">{WEEKDAYS[best.d].toLowerCase()} {hourLabel(best.h)}–{hourLabel((best.h + 1) % 24)}</b> ({plural(best.v, "page vue", "pages vues")})</span>
        <span className="flex items-center gap-1">Moins{fill.map((f, i) => <span key={i} className="h-3 w-3 rounded-[3px]" style={{ background: f }} />)}Plus</span>
      </div>
    </div>
  );
}
