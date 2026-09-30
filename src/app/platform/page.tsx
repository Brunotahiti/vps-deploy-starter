"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, AlertTriangle, Ban, Building2, CalendarClock, Clock3, ExternalLink, Globe, Eye, EyeOff, Hourglass, Lock, LogIn, Mail, MailCheck, Moon, RefreshCw, Search, ShieldCheck, Sparkles, Sun, TrendingUp, Unlock, UserPlus, Users, Wallet } from "lucide-react";
import { api, ApiClientError } from "@/lib/api-client";
import { useSession, type Me } from "@/hooks/use-session";
import { useTheme } from "@/hooks/use-theme";
import { useAction } from "@/components/admin/common";
import { ChartCard, ColumnChart, HBars, Stat } from "@/components/admin/charts";
import { Logo } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Badge, Spinner } from "@/components/ui/misc";
import { formatDate, formatDateTime } from "@/lib/dates";
import { EMAIL_KIND_LABEL, STATUS_LABEL, formatMinutes, relativeDays, type AccountStatus } from "@/lib/platform";
import type { PlatformRow, platformOrgDetail, platformOverview } from "@/server/services/platform";

type Overview = Awaited<ReturnType<typeof platformOverview>>;
type Detail = Awaited<ReturnType<typeof platformOrgDetail>>;

const TZ = "Pacific/Tahiti";
const F = (v: number) => `${v.toLocaleString("fr-FR")} F`;
const STATUS_COLOR: Record<AccountStatus, "blue" | "orange" | "green" | "gray" | "red"> = { TRIAL: "blue", EXPIRED: "orange", ACTIVE: "green", SUSPENDED: "gray", BLOCKED: "red" };
const FILTERS: ("ALL" | AccountStatus)[] = ["ALL", "TRIAL", "EXPIRED", "ACTIVE", "SUSPENDED", "BLOCKED"];
const DEMO_STATUS: Record<string, string> = { NEW: "Nouvelle", CONTACTED: "Contacté", DONE: "Traitée" };
const shortDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const plusDays = (n: number) => isoDay(new Date(Date.now() + n * 86_400_000));

const TEMPLATES = [
  { label: "Aide au démarrage", subject: "Besoin d'aide pour démarrer ManaResto ?", message: "Ia ora na,\n\nJe vois que vous avez créé votre compte ManaResto : merci pour votre confiance !\n\nSi vous le souhaitez, nous pouvons vous aider à ajouter votre carte, vos photos et votre plan de salle. Répondez simplement à cet e-mail avec vos disponibilités.\n\nBonne journée," },
  { label: "Fin d'essai", subject: "Votre essai ManaResto touche à sa fin", message: "Ia ora na,\n\nVotre période d'essai gratuit arrive à son terme. Pour continuer à utiliser ManaResto : 12 000 F CFP par mois, engagement 12 mois, 0 % de commission.\n\nRépondez à cet e-mail et nous activons votre abonnement.\n\nMāuruuru," },
];

export default function PlatformPage() {
  const { me, isLoading: meLoading } = useSession();
  const { toggle } = useTheme();
  const qc = useQueryClient();
  const act = useAction();
  const q = useQuery({ queryKey: ["platform"], queryFn: () => api.get<Overview>("/api/platform/overview"), enabled: !!me?.platformAdmin, refetchInterval: 60_000 });
  const [filter, setFilter] = useState<"ALL" | AccountStatus>("ALL");
  const [search, setSearch] = useState("");
  const [showDemo, setShowDemo] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [mail, setMail] = useState<{ row: PlatformRow; subject: string; message: string } | null>(null);
  const [block, setBlock] = useState<{ row: PlatformRow; reason: string } | null>(null);
  const [plan, setPlan] = useState<{ row: PlatformRow; plan: "TRIAL" | "ACTIVE" | "SUSPENDED"; trialEndsAt: string; periodEndsAt: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const data = q.data;
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (data?.rows ?? []).filter((r) => (showDemo || !r.isDemo) && (filter === "ALL" || r.status === filter) && (!s || [r.name, r.owner?.email, r.owner?.firstName, r.owner?.lastName, r.establishment?.name, r.establishment?.city].some((v) => v?.toLowerCase().includes(s))));
  }, [data, filter, search, showDemo]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: 0 };
    for (const r of data?.rows ?? []) { if (!showDemo && r.isDemo) continue; c.ALL++; c[r.status] = (c[r.status] ?? 0) + 1; }
    return c;
  }, [data, showDemo]);

  if (meLoading) return <div className="flex h-dvh items-center justify-center"><Spinner /></div>;
  if (!me?.platformAdmin) return <AdminLogin current={me?.user?.email ?? null} />;

  const refresh = () => { qc.invalidateQueries({ queryKey: ["platform"] }); if (detailId) qc.invalidateQueries({ queryKey: ["platform-org", detailId] }); };
  const impersonate = async (r: PlatformRow) => {
    if (!confirm(`Prendre la main sur le compte de ${r.owner ? `${r.owner.firstName} ${r.owner.lastName}` : r.name} ?\n\nVous verrez l'application exactement comme le restaurateur. Un bandeau violet permet de revenir à la console.`)) return;
    const res = await act(() => api.post<{ redirect: string }>(`/api/platform/orgs/${r.id}/impersonate`));
    if (res) { qc.clear(); window.location.href = res.redirect; }
  };
  const quickPlan = async (r: PlatformRow, choice: string) => {
    if (choice === "custom") { setPlan({ row: r, plan: r.plan, trialEndsAt: (r.trialEndsAt ?? plusDays(15)).slice(0, 10), periodEndsAt: (r.periodEndsAt ?? plusDays(365)).slice(0, 10) }); return; }
    const body = choice === "TRIAL15" ? { plan: "TRIAL", trialEndsAt: plusDays(15) } : choice === "TRIAL7" ? { plan: "TRIAL", trialEndsAt: plusDays(7) } : choice === "ACTIVE" ? { plan: "ACTIVE" } : { plan: "SUSPENDED" };
    const label = choice === "TRIAL15" ? "essai prolongé de 15 jours" : choice === "TRIAL7" ? "essai prolongé de 7 jours" : choice === "ACTIVE" ? "abonnement actif (12 mois)" : "compte suspendu";
    if (!confirm(`${r.name} : ${label} ?`)) return;
    await act(() => api.patch(`/api/platform/orgs/${r.id}/plan`, body), { success: `${r.name} : ${label}`, invalidate: [["platform"], ["platform-org", r.id]] });
  };
  const toggleBlock = async (r: PlatformRow) => {
    if (r.blockedAt) { if (confirm(`Débloquer ${r.name} ? L'équipe pourra de nouveau se connecter.`)) await act(() => api.post(`/api/platform/orgs/${r.id}/block`, { blocked: false }), { success: `${r.name} débloqué`, invalidate: [["platform"], ["platform-org", r.id]] }); }
    else setBlock({ row: r, reason: "" });
  };
  const runLifecycle = async () => {
    const r = await act(() => api.post<{ reminders: number; expired: number }>("/api/platform/lifecycle"), { invalidate: [["platform"]] });
    if (r) alert(`Relances envoyées : ${r.reminders} rappel(s) de fin d'essai, ${r.expired} e-mail(s) « essai expiré ».`);
  };
  const actions = { impersonate, quickPlan, toggleBlock, email: (r: PlatformRow) => setMail({ row: r, subject: "", message: "" }) };

  return (
    <div className="min-h-dvh bg-[var(--bg)]">
      {/* En-tête */}
      <header className="relative overflow-hidden bg-[linear-gradient(135deg,#0f6e6c,#14aaa3_55%,#0b4f4e)] text-white">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/10 blur-2xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 left-1/3 h-72 w-72 rounded-full bg-[#f97c3c]/25 blur-3xl" />
        <div className="relative mx-auto max-w-[1500px] px-4 pb-6 pt-4 sm:px-6" style={{ paddingTop: "max(16px, env(safe-area-inset-top))" }}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Logo size={34} light />
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={refresh} className="touch inline-flex h-10 items-center gap-2 rounded-xl bg-white/15 px-3 text-sm font-semibold hover:bg-white/25" aria-label="Actualiser"><RefreshCw className={`h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} /><span className="hidden sm:inline">Actualiser</span></button>
              <button onClick={runLifecycle} className="touch inline-flex h-10 items-center gap-2 rounded-xl bg-white/15 px-3 text-sm font-semibold hover:bg-white/25" title="Envoie tout de suite les rappels de fin d'essai et les e-mails « essai expiré » en attente"><MailCheck className="h-4 w-4" /><span className="hidden sm:inline">Lancer les relances</span></button>
              <Link href="/admin" className="touch inline-flex h-10 items-center gap-2 rounded-xl bg-white px-3 text-sm font-bold text-[#0f6e6c]"><Building2 className="h-4 w-4" />Mon restaurant</Link>
              <button onClick={toggle} className="touch rounded-xl bg-white/15 p-2.5 hover:bg-white/25" aria-label="Changer de thème"><Sun className="h-4 w-4 dark:hidden" /><Moon className="hidden h-4 w-4 dark:block" /></button>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/75">Console plateforme</p>
              <h1 className="mt-1 text-3xl font-extrabold tracking-tight sm:text-4xl">Vos restaurants ManaResto</h1>
              <p className="mt-1 text-sm text-white/85">Inscriptions, essais, abonnements et qui utilise vraiment l&apos;application.</p>
            </div>
            {data ? <div className="rounded-2xl bg-white/12 px-4 py-2 text-right ring-1 ring-white/20 backdrop-blur"><p className="text-[11px] font-bold uppercase tracking-wider text-white/75">Revenu mensuel</p><p className="text-2xl font-extrabold tabular-nums">{F(data.kpis.mrr)}</p><p className="text-[11px] text-white/80">{data.kpis.active} abonné{data.kpis.active > 1 ? "s" : ""} · {F(data.kpis.arr)} / an</p></div> : null}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] space-y-6 px-4 py-6 sm:px-6">
        {q.isLoading ? <div className="flex justify-center py-16"><Spinner /></div> : q.error ? (
          <div className="card flex items-center gap-3 p-4 text-sm text-red-600"><AlertTriangle className="h-5 w-5" />{q.error instanceof ApiClientError ? q.error.message : "Chargement impossible"}</div>
        ) : data ? (
          <>
            {!data.emailConfigured ? <div className="card flex items-start gap-3 border-orange-300 p-4 text-sm"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-orange-500" /><p><b>Envoi d&apos;e-mails non configuré.</b> Les e-mails de bienvenue, de fin d&apos;essai et vos messages ne partent pas. Renseignez les variables SMTP (relais Brevo) dans le fichier .env du serveur puis redéployez.</p></div> : null}

            {/* Indicateurs */}
            <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Restaurants inscrits" value={data.kpis.restaurants} icon={<Building2 className="h-4 w-4" />} hint={`+${data.kpis.signups7} cette semaine`} />
              <Stat label="Inscriptions 30 j" value={data.kpis.signups30} icon={<UserPlus className="h-4 w-4" />} accent="#7c3aed" hint={`30 j précédents : ${data.kpis.signupsPrev30}`} />
              <Stat label="Essais en cours" value={data.kpis.trials} icon={<Hourglass className="h-4 w-4" />} accent="#2563eb" hint={data.kpis.trialsEndingSoon ? `${data.kpis.trialsEndingSoon} finissent sous 3 j` : "aucun ne finit sous 3 j"} />
              <Stat label="Essais expirés" value={data.kpis.expired} icon={<CalendarClock className="h-4 w-4" />} accent="#f97c3c" hint={data.kpis.expired ? "à relancer" : "rien à relancer"} />
              <Stat label="Abonnés actifs" value={data.kpis.active} icon={<Wallet className="h-4 w-4" />} accent="#16a34a" hint={data.kpis.conversion === null ? "—" : `conversion ${data.kpis.conversion.toLocaleString("fr-FR")} %`} />
              <Stat label="Actifs sur 7 jours" value={data.kpis.active7} icon={<Activity className="h-4 w-4" />} accent="#0ea5a4" hint={`${formatMinutes(data.kpis.minutes7)} d'utilisation`} />
              <Stat label="Suspendus · bloqués" value={`${data.kpis.suspended} · ${data.kpis.blocked}`} icon={<Ban className="h-4 w-4" />} accent="#dc2626" hint="comptes sans accès payant" />
              <Stat label="Demandes de démo" value={data.kpis.demoNew} icon={<Sparkles className="h-4 w-4" />} accent="#db2777" hint={`nouvelles · ${data.kpis.demoTotal} au total`} />
            </section>

            {/* Graphiques */}
            <section className="grid gap-4 lg:grid-cols-3">
              <ChartCard title="Inscriptions par jour" subtitle="30 derniers jours" table={{ head: ["Jour", "Inscriptions"], rows: data.series.map((d) => [shortDay(d.day), d.signups]) }}>
                <ColumnChart data={data.series.map((d) => ({ label: shortDay(d.day), value: d.signups }))} valueLabel={(v) => `${v} inscription${v > 1 ? "s" : ""}`} height={190} emphasis="none" />
              </ChartCard>
              <ChartCard title="Restaurants actifs par jour" subtitle="Au moins une minute d'utilisation" table={{ head: ["Jour", "Restaurants", "Minutes"], rows: data.series.map((d) => [shortDay(d.day), d.activeOrgs, d.minutes]) }}>
                <ColumnChart data={data.series.map((d) => ({ label: shortDay(d.day), value: d.activeOrgs, sub: formatMinutes(d.minutes) }))} valueLabel={(v) => `${v} restaurant${v > 1 ? "s" : ""}`} height={190} color="var(--viz-3)" emphasis="none" />
              </ChartCard>
              <ChartCard title="Parcours des inscrits" subtitle="De l'inscription à l'abonnement">
                <Funnel rows={(data.rows ?? []).filter((r) => !r.isDemo)} />
              </ChartCard>
            </section>

            {/* Restaurants */}
            <section className="card overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
                <div><h2 className="text-lg font-extrabold tracking-tight">Restaurants</h2><p className="text-xs text-muted">Touchez une ligne pour voir l&apos;équipe, les connexions et l&apos;historique.</p></div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><Input placeholder="Nom, e-mail, commune…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-56 pl-9" aria-label="Rechercher un restaurant" /></label>
                  <label className="flex items-center gap-2 text-xs font-semibold text-muted"><input type="checkbox" checked={showDemo} onChange={(e) => setShowDemo(e.target.checked)} />Compte démo</label>
                </div>
              </div>
              <div className="flex gap-1 overflow-x-auto border-b border-line px-3 py-2">
                {FILTERS.map((f) => <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f} className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold transition ${filter === f ? "bg-brand text-white" : "text-muted hover:surface-2"}`}>{f === "ALL" ? "Tous" : STATUS_LABEL[f]} <span className="opacity-70">{counts[f] ?? 0}</span></button>)}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1320px] text-sm">
                  <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted">{["Propriétaire", "Plan", "Statut", "Fin essai / période", "Activité", "Dernier e-mail", "Page publique", "Inscription", "Facturation", "Actions"].map((h) => <th key={h} className="px-3 py-3 font-bold">{h}</th>)}</tr></thead>
                  <tbody>
                    {rows.length === 0 ? <tr><td colSpan={10} className="px-4 py-10 text-center text-sm text-muted">Aucun restaurant pour ce filtre.</td></tr> : rows.map((r) => <OrgRow key={r.id} r={r} mine={r.id === me.organizationId} onOpen={() => setDetailId(r.id)} {...actions} />)}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-5">
              {/* Connexions récentes */}
              <div className="card p-4 lg:col-span-2">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-extrabold"><LogIn className="h-4 w-4 text-lagon-600" />Dernières connexions</h2>
                {data.recentLogins.length === 0 ? <p className="py-6 text-center text-sm text-muted">Aucune connexion pour l&apos;instant.</p> : (
                  <ul className="divide-y divide-[var(--line)]">
                    {data.recentLogins.map((u) => (
                      <li key={u.id} className="flex items-center gap-3 py-2">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-lagon-500/15 text-xs font-bold text-lagon-700">{u.name.slice(0, 1).toUpperCase()}</span>
                        <button onClick={() => setDetailId(u.organization.id)} className="min-w-0 flex-1 text-left"><span className="block truncate text-sm font-semibold">{u.name}{u.isOwner ? <span className="ml-1 text-[10px] font-bold uppercase text-muted">propriétaire</span> : null}</span><span className="block truncate text-xs text-muted">{u.organization.name} · {u.email}</span></button>
                        <span className="shrink-0 text-right text-xs text-muted" title={formatDateTime(u.at, TZ)}>{relativeDays(u.at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {/* Demandes de démo */}
              <div className="card p-4 lg:col-span-3">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-extrabold"><Sparkles className="h-4 w-4 text-pink-600" />Demandes de démonstration <span className="text-xs font-semibold text-muted">(site vitrine)</span></h2>
                {data.demoRequests.length === 0 ? <p className="py-6 text-center text-sm text-muted">Aucune demande pour l&apos;instant.</p> : (
                  <div className="max-h-[420px] overflow-auto">
                    <table className="w-full min-w-[620px] text-sm">
                      <thead className="sticky top-0 surface"><tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted"><th className="py-2 pr-3">Établissement</th><th className="py-2 pr-3">Contact</th><th className="py-2 pr-3">Reçue</th><th className="py-2">Suivi</th></tr></thead>
                      <tbody>
                        {data.demoRequests.map((d) => (
                          <tr key={d.id} className="border-b border-line align-top last:border-0">
                            <td className="py-2 pr-3"><span className="font-semibold">{d.restaurantName}</span><span className="block text-xs text-muted">{d.kind.toLowerCase()} · {d.commune}</span>{d.message ? <span className="mt-1 block max-w-xs text-xs italic text-muted">« {d.message} »</span> : null}</td>
                            <td className="py-2 pr-3"><span className="font-semibold">{d.contactName}</span><a href={`tel:${d.phone.replace(/[^+\d]/g, "")}`} className="block text-xs text-lagon-700 underline">{d.phone}</a><a href={`mailto:${d.email}`} className="block text-xs text-lagon-700 underline">{d.email}</a></td>
                            <td className="py-2 pr-3 text-xs text-muted" title={formatDateTime(d.createdAt, TZ)}>{relativeDays(d.createdAt)}</td>
                            <td className="py-2"><Select value={d.status} onChange={(e) => act(() => api.patch(`/api/platform/demo-requests/${d.id}`, { status: e.target.value }), { invalidate: [["platform"]] })} className="h-9 w-32 text-xs" aria-label={`Suivi de ${d.restaurantName}`}>{Object.entries(DEMO_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>
            <p className="pb-4 text-center text-xs text-muted">Temps d&apos;utilisation : minutes pendant lesquelles l&apos;application est ouverte et visible (hors prises en main du support). Le compte de démonstration est exclu des indicateurs.</p>
          </>
        ) : null}
      </main>

      <OrgDetail id={detailId} onClose={() => setDetailId(null)} row={data?.rows.find((r) => r.id === detailId) ?? null} mine={detailId === me.organizationId} {...actions} />

      <Modal open={!!mail} onClose={() => setMail(null)} title={mail ? `Écrire à ${mail.row.owner?.firstName ?? ""} ${mail.row.owner?.lastName ?? ""} · ${mail.row.name}` : ""} size="lg"
        footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setMail(null)}>Annuler</Button><Button loading={busy} disabled={!mail || mail.subject.trim().length < 2 || mail.message.trim().length < 2} onClick={async () => { if (!mail) return; setBusy(true); const r = await act(() => api.post(`/api/platform/orgs/${mail.row.id}/email`, { subject: mail.subject, message: mail.message }), { success: `E-mail envoyé à ${mail.row.owner?.email}`, invalidate: [["platform"], ["platform-org", mail.row.id]] }); setBusy(false); if (r) setMail(null); }}>Envoyer l&apos;e-mail</Button></div>}>
        {mail ? (
          <div className="space-y-3">
            <p className="text-sm text-muted">Destinataire : <b className="text-[var(--text)]">{mail.row.owner?.email}</b>. L&apos;e-mail part aux couleurs de ManaResto ; les réponses arrivent sur l&apos;adresse de contact.</p>
            <div className="flex flex-wrap gap-2">{TEMPLATES.map((t) => <button key={t.label} type="button" onClick={() => setMail({ ...mail, subject: t.subject, message: t.message })} className="rounded-full surface-2 px-3 py-1 text-xs font-semibold">Modèle : {t.label}</button>)}</div>
            <Field label="Objet"><Input value={mail.subject} onChange={(e) => setMail({ ...mail, subject: e.target.value })} maxLength={150} /></Field>
            <Field label="Message" hint="Laissez une ligne vide entre deux paragraphes."><Textarea rows={9} value={mail.message} onChange={(e) => setMail({ ...mail, message: e.target.value })} maxLength={5000} /></Field>
          </div>
        ) : null}
      </Modal>

      <Modal open={!!block} onClose={() => setBlock(null)} title={block ? `Bloquer ${block.row.name}` : ""}
        footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setBlock(null)}>Annuler</Button><Button variant="danger" loading={busy} onClick={async () => { if (!block) return; setBusy(true); const r = await act(() => api.post(`/api/platform/orgs/${block.row.id}/block`, { blocked: true, reason: block.reason || null }), { success: `${block.row.name} bloqué`, invalidate: [["platform"], ["platform-org", block.row.id]] }); setBusy(false); if (r) setBlock(null); }}>Bloquer le compte</Button></div>}>
        {block ? <div className="space-y-3"><p className="text-sm">Toute l&apos;équipe de <b>{block.row.name}</b> est déconnectée et ne peut plus se connecter (message : « Ce compte est suspendu, contactez-nous »). Les données sont conservées ; vous pouvez débloquer à tout moment.</p><Field label="Motif (interne, facultatif)"><Input value={block.reason} onChange={(e) => setBlock({ ...block, reason: e.target.value })} maxLength={300} placeholder="Ex. impayé, compte de test, abus…" /></Field></div> : null}
      </Modal>

      <Modal open={!!plan} onClose={() => setPlan(null)} title={plan ? `Abonnement · ${plan.row.name}` : ""}
        footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setPlan(null)}>Annuler</Button><Button loading={busy} onClick={async () => { if (!plan) return; setBusy(true); const body = { plan: plan.plan, trialEndsAt: plan.plan === "TRIAL" ? new Date(`${plan.trialEndsAt}T23:59:00-10:00`).toISOString() : undefined, periodEndsAt: plan.plan === "ACTIVE" ? new Date(`${plan.periodEndsAt}T23:59:00-10:00`).toISOString() : undefined }; const r = await act(() => api.patch(`/api/platform/orgs/${plan.row.id}/plan`, body), { success: "Abonnement mis à jour", invalidate: [["platform"], ["platform-org", plan.row.id]] }); setBusy(false); if (r) setPlan(null); }}>Enregistrer</Button></div>}>
        {plan ? (
          <div className="space-y-3">
            <Field label="Statut"><Select value={plan.plan} onChange={(e) => setPlan({ ...plan, plan: e.target.value as "TRIAL" | "ACTIVE" | "SUSPENDED" })}><option value="TRIAL">Essai gratuit</option><option value="ACTIVE">Abonnement actif</option><option value="SUSPENDED">Suspendu</option></Select></Field>
            {plan.plan === "TRIAL" ? <Field label="Fin de l'essai"><Input type="date" value={plan.trialEndsAt} onChange={(e) => setPlan({ ...plan, trialEndsAt: e.target.value })} /></Field> : null}
            {plan.plan === "ACTIVE" ? <Field label="Fin de la période d'engagement" hint="Par défaut : 12 mois après l'activation."><Input type="date" value={plan.periodEndsAt} onChange={(e) => setPlan({ ...plan, periodEndsAt: e.target.value })} /></Field> : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

type RowActions = { impersonate: (r: PlatformRow) => void; quickPlan: (r: PlatformRow, choice: string) => void; toggleBlock: (r: PlatformRow) => void; email: (r: PlatformRow) => void };

function PeriodCell({ r }: { r: Pick<PlatformRow, "status" | "trialEndsAt" | "periodEndsAt" | "endingSoon"> }) {
  const date = r.status === "ACTIVE" ? r.periodEndsAt : r.status === "TRIAL" || r.status === "EXPIRED" ? r.trialEndsAt : null;
  if (!date) return <span className="text-muted">—</span>;
  const soon = r.endingSoon;
  return <span><span className="font-semibold">{formatDate(date, TZ)}</span><span className={`block text-xs ${r.status === "EXPIRED" ? "text-orange-600" : soon ? "font-bold text-orange-600" : "text-muted"}`}>{relativeDays(date)}</span></span>;
}

function ActionButtons({ r, mine, impersonate, quickPlan, toggleBlock, email, wide = false }: RowActions & { r: PlatformRow; mine: boolean; wide?: boolean }) {
  const btn = `touch inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-bold transition ${wide ? "" : ""}`;
  return (
    <div className="flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      <button onClick={() => impersonate(r)} disabled={!r.owner || mine} className={`${btn} bg-[#7c3aed] text-white hover:brightness-110 disabled:opacity-40`} title={mine ? "C'est votre propre compte" : "Ouvrir l'application comme ce restaurateur"}><LogIn className="h-3.5 w-3.5" />Prendre la main</button>
      <button onClick={() => email(r)} disabled={!r.owner} className={`${btn} surface-2 hover:brightness-95`} title="Envoyer un e-mail au propriétaire"><Mail className="h-3.5 w-3.5" />E-mail</button>
      <button onClick={() => toggleBlock(r)} disabled={mine} className={`${btn} ${r.blockedAt ? "bg-green-500/15 text-green-700" : "bg-red-500/10 text-red-600"} disabled:opacity-40`}>{r.blockedAt ? <><Unlock className="h-3.5 w-3.5" />Débloquer</> : <><Ban className="h-3.5 w-3.5" />Bloquer</>}</button>
      <select value="" onChange={(e) => { quickPlan(r, e.target.value); e.target.value = ""; }} aria-label={`Changer le statut de ${r.name}`} className="h-9 rounded-lg border border-line surface px-2 text-xs font-semibold">
        <option value="" disabled>Statut…</option>
        <option value="TRIAL15">Essai : +15 jours</option>
        <option value="TRIAL7">Essai : +7 jours</option>
        <option value="ACTIVE">Activer l&apos;abonnement</option>
        <option value="SUSPENDED">Suspendre</option>
        <option value="custom">Dates personnalisées…</option>
      </select>
    </div>
  );
}

function OrgRow({ r, mine, onOpen, ...a }: RowActions & { r: PlatformRow; mine: boolean; onOpen: () => void }) {
  return (
    <tr onClick={onOpen} className="cursor-pointer border-b border-line align-top transition last:border-0 hover:surface-2">
      <td className="px-3 py-3">
        <span className="block font-bold">{r.owner ? `${r.owner.firstName} ${r.owner.lastName}` : "—"}{mine ? <Badge color="teal">vous</Badge> : null}{r.isDemo ? <Badge color="purple">démo</Badge> : null}</span>
        <span className="block text-xs text-muted">{r.owner?.email}</span>
        <span className="mt-0.5 block text-xs font-semibold text-lagon-700">{r.name}{r.establishment?.city ? <span className="font-normal text-muted"> · {r.establishment.city}</span> : null}</span>
      </td>
      <td className="px-3 py-3"><span className="font-semibold">{r.plan === "ACTIVE" ? "Abonnement" : r.plan === "TRIAL" ? "Essai gratuit" : "Suspendu"}</span><span className="block text-xs text-muted">{r.establishments} établ. · {r.users} util.</span></td>
      <td className="px-3 py-3"><Badge color={STATUS_COLOR[r.status]}>{STATUS_LABEL[r.status]}</Badge>{r.blockedReason ? <span className="mt-1 block max-w-[140px] text-[11px] text-muted">{r.blockedReason}</span> : null}</td>
      <td className="px-3 py-3"><PeriodCell r={r} /></td>
      <td className="px-3 py-3">
        <span className="block whitespace-nowrap text-xs"><span className="text-muted">7 j :</span> <b>{formatMinutes(r.minutes7)}</b></span>
        <span className="block whitespace-nowrap text-xs"><span className="text-muted">30 j :</span> <b>{formatMinutes(r.minutes30)}</b></span>
        <span className="block whitespace-nowrap text-xs text-muted" title={r.lastSeenAt ? formatDateTime(r.lastSeenAt, TZ) : undefined}>{r.lastSeenAt ? `vu ${relativeDays(r.lastSeenAt)}` : "jamais connecté"}</span>
        <span className="block whitespace-nowrap text-xs text-muted">{r.orders30} commande{r.orders30 > 1 ? "s" : ""} · 30 j</span>
      </td>
      <td className="px-3 py-3">{r.lastEmail ? <><span className={`block text-xs font-semibold ${r.lastEmail.status === "FAILED" ? "text-red-600" : ""}`}>{EMAIL_KIND_LABEL[r.lastEmail.kind] ?? r.lastEmail.kind}{r.lastEmail.status === "FAILED" ? " (échec)" : ""}</span><span className="block text-xs text-muted">{relativeDays(r.lastEmail.at)} · {r.emailsTotal} au total</span></> : <span className="text-xs text-muted">aucun</span>}</td>
      <td className="px-3 py-3">{r.publicPath ? <a href={r.publicPath} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-xs font-semibold text-lagon-700 underline"><Globe className="h-3.5 w-3.5" />Voir le site<ExternalLink className="h-3 w-3" /></a> : <span className="text-xs text-muted">—</span>}</td>
      <td className="px-3 py-3"><span className="block text-xs font-semibold">{formatDate(r.createdAt, TZ)}</span><span className="block text-xs text-muted">{relativeDays(r.createdAt)}</span></td>
      <td className="px-3 py-3 text-xs">{r.status === "ACTIVE" ? <><b>12 000 F / mois</b><span className="block text-muted">depuis {r.planStartedAt ? formatDate(r.planStartedAt, TZ) : "—"}</span></> : <span className="text-muted">—</span>}{r.billingEmail ? <span className="block text-muted">{r.billingEmail}</span> : null}</td>
      <td className="px-3 py-3"><ActionButtons r={r} mine={mine} {...a} /></td>
    </tr>
  );
}

/** Entonnoir : inscrits → ont utilisé l'application → utilisation régulière (3 jours ou plus sur 30 j) → abonnés. */
function Funnel({ rows }: { rows: PlatformRow[] }) {
  const total = rows.length;
  const used = rows.filter((r) => r.minutes30 > 0 || r.orders30 > 0).length;
  const regular = rows.filter((r) => r.activeDays30 >= 3).length;
  const paying = rows.filter((r) => r.status === "ACTIVE").length;
  const p = (n: number) => (total ? ` · ${Math.round((n / total) * 100)} %` : "");
  return (
    <div className="pt-2">
      <HBars max={total} valueLabel={(v) => String(v)} data={[
        { label: "Inscrits", value: total },
        { label: "Ont utilisé l'application", value: used, hint: p(used) },
        { label: "Utilisation régulière (3 j et +)", value: regular, hint: p(regular) },
        { label: "Abonnés", value: paying, hint: p(paying) },
      ]} />
      <p className="mt-4 text-xs text-muted">Sur les 30 derniers jours pour l&apos;utilisation ; statut actuel pour les abonnés.</p>
    </div>
  );
}

function OrgDetail({ id, row, mine, onClose, ...a }: RowActions & { id: string | null; row: PlatformRow | null; mine: boolean; onClose: () => void }) {
  const q = useQuery({ queryKey: ["platform-org", id], queryFn: () => api.get<Detail>(`/api/platform/orgs/${id}`), enabled: !!id });
  const d = q.data;
  return (
    <Modal open={!!id} onClose={onClose} title={d ? d.name : "Restaurant"} size="xl">
      {!d ? <div className="flex justify-center py-10"><Spinner /></div> : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge color={STATUS_COLOR[d.status]}>{STATUS_LABEL[d.status]}</Badge>
            <span className="text-sm text-muted">Inscrit le {formatDate(d.createdAt, TZ)} ({relativeDays(d.createdAt)})</span>
            {d.status === "TRIAL" || d.status === "EXPIRED" ? <span className="text-sm text-muted">· fin d&apos;essai {d.trialEndsAt ? `${formatDate(d.trialEndsAt, TZ)} (${relativeDays(d.trialEndsAt)})` : "—"}</span> : null}
            {d.status === "ACTIVE" && d.periodEndsAt ? <span className="text-sm text-muted">· engagement jusqu&apos;au {formatDate(d.periodEndsAt, TZ)}</span> : null}
          </div>
          {row ? <ActionButtons r={row} mine={mine} {...a} /> : null}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Mini icon={<TrendingUp className="h-4 w-4" />} label="Commandes 30 j" value={d.counts.orders30} hint={`${d.counts.ordersTotal} au total${d.counts.lastOrderAt ? ` · dernière ${relativeDays(d.counts.lastOrderAt)}` : ""}`} />
            <Mini icon={<Building2 className="h-4 w-4" />} label="Produits" value={d.counts.products} hint={`${d.counts.tables} tables`} />
            <Mini icon={<Users className="h-4 w-4" />} label="Équipe" value={d.users.length} hint={`${d.users.filter((u) => u.invitePending).length} invitation(s) en attente`} />
            <Mini icon={<Clock3 className="h-4 w-4" />} label="Utilisation 30 j" value={formatMinutes(d.activity.reduce((s, x) => s + x.minutes, 0))} hint={`${d.activity.filter((x) => x.minutes > 0).length} jour(s) actif(s)`} />
          </div>

          <ChartCard title="Temps d'utilisation par jour" subtitle="30 derniers jours, en minutes">
            <ColumnChart data={d.activity.map((x) => ({ label: shortDay(x.day), value: x.minutes }))} valueLabel={formatMinutes} height={150} emphasis="none" />
          </ChartCard>

          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-extrabold">Équipe et connexions</h3>
              <ul className="divide-y divide-[var(--line)] rounded-xl border border-line">
                {d.users.map((u) => (
                  <li key={u.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{u.name}{u.isOwner ? <Badge color="teal">propriétaire</Badge> : null}{u.invitePending ? <Badge color="orange">invité</Badge> : null}{!u.isActive ? <Badge color="gray">désactivé</Badge> : null}</span><span className="block truncate text-xs text-muted">{u.email}</span></span>
                    <span className="shrink-0 text-right text-xs text-muted"><span className="block">{u.lastLoginAt ? `connecté ${relativeDays(u.lastLoginAt)}` : "jamais connecté"}</span><span className="block">{formatMinutes(u.minutes30)} sur 30 j</span></span>
                  </li>
                ))}
              </ul>
              <h3 className="mb-2 mt-4 text-sm font-extrabold">Appareils connectés</h3>
              {d.sessions.length === 0 ? <p className="text-xs text-muted">Aucune session ouverte.</p> : (
                <ul className="divide-y divide-[var(--line)] rounded-xl border border-line">
                  {d.sessions.map((s) => <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs"><span><b>{s.user}</b> · {s.device}{s.support ? <Badge color="purple">support</Badge> : null}</span><span className="shrink-0 text-muted" title={formatDateTime(s.lastSeenAt, TZ)}>actif {relativeDays(s.lastSeenAt)}</span></li>)}
                </ul>
              )}
            </div>
            <div>
              <h3 className="mb-2 text-sm font-extrabold">Établissements</h3>
              <ul className="mb-4 divide-y divide-[var(--line)] rounded-xl border border-line">
                {d.establishments.map((e) => <li key={e.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm"><span><b>{e.name}</b><span className="block text-xs text-muted">{[e.city, e.island].filter(Boolean).join(", ") || "Adresse non renseignée"}{e.phone ? ` · ${e.phone}` : ""}{!e.onboardingDone ? " · démarrage en cours" : ""}</span></span><a href={e.publicPath} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-lagon-700 underline"><Globe className="h-3.5 w-3.5" />Site</a></li>)}
              </ul>
              <h3 className="mb-2 text-sm font-extrabold">E-mails envoyés</h3>
              {d.emails.length === 0 ? <p className="text-xs text-muted">Aucun e-mail envoyé à ce restaurant.</p> : (
                <ul className="divide-y divide-[var(--line)] rounded-xl border border-line">
                  {d.emails.map((m) => <li key={m.id} className="px-3 py-2 text-xs"><span className="flex items-center justify-between gap-2"><b>{EMAIL_KIND_LABEL[m.kind] ?? m.kind}</b><span className="text-muted" title={formatDateTime(m.createdAt, TZ)}>{relativeDays(m.createdAt)}</span></span><span className="block truncate text-muted">{m.subject} → {m.to}</span>{m.status === "FAILED" ? <span className="block text-red-600">Échec : {m.error}</span> : null}</li>)}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Mini({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: React.ReactNode; hint?: string }) {
  return <div className="rounded-2xl border border-line p-3"><p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted">{icon}{label}</p><p className="mt-1 text-xl font-extrabold">{value}</p>{hint ? <p className="text-xs text-muted">{hint}</p> : null}</div>;
}

/** Connexion administrateur de la console : e-mail et mot de passe d'un compte listé dans PLATFORM_ADMIN_EMAILS. */
function AdminLogin({ current }: { current: string | null }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/auth/login", { email: email.trim(), password });
      const me = await api.get<Me>("/api/auth/me");
      if (!me.platformAdmin) {
        // Compte valide mais sans droits d'administration : on ne le laisse pas connecté ici
        await api.post("/api/auth/logout").catch(() => null);
        qc.setQueryData(["me"], { user: null, terminal: null });
        setError("Ce compte n'a pas les droits d'administration de la console ManaResto.");
        setBusy(false);
        return;
      }
      qc.setQueryData(["me"], me);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Connexion impossible, réessayez.");
      setBusy(false);
    }
  };
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[linear-gradient(135deg,#0b4f4e,#0f6e6c_45%,#14aaa3)] p-4">
      <div className="w-full max-w-md">
        <div className="mb-5 flex justify-center"><Logo size={40} light /></div>
        <form onSubmit={submit} className="card space-y-4 p-6 shadow-2xl" aria-labelledby="admin-login-title">
          <div className="text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-lagon-500/12 text-lagon-600"><ShieldCheck className="h-6 w-6" /></span>
            <h1 id="admin-login-title" className="mt-3 text-xl font-extrabold tracking-tight">Console ManaResto</h1>
            <p className="mt-1 text-sm text-muted">Connexion administrateur</p>
          </div>
          {current ? <p className="rounded-xl surface-2 px-3 py-2 text-xs text-muted">Vous êtes connecté avec <b className="text-[var(--text)]">{current}</b>, qui n&apos;a pas accès à la console. Connectez-vous avec votre compte administrateur.</p> : null}
          <Field label="Adresse e-mail"><Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="vous@manaresto.com" /></Field>
          <Field label="Mot de passe">
            <div className="relative">
              <Input type={show ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="pr-11" />
              <button type="button" onClick={() => setShow(!show)} className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted hover:surface-2" aria-label={show ? "Masquer la saisie" : "Afficher la saisie"}>{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
            </div>
          </Field>
          {error ? <p role="alert" className="rounded-xl bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-600">{error}</p> : null}
          <Button type="submit" loading={busy} disabled={!email || !password} className="h-12 w-full"><Lock className="h-4 w-4" />Se connecter à la console</Button>
          <p className="text-center text-xs text-muted">Accès réservé aux adresses listées dans la variable PLATFORM_ADMIN_EMAILS du serveur.</p>
        </form>
        <p className="mt-4 text-center text-sm text-white/85"><a href="https://www.manaresto.com" className="underline">Retour au site</a>{current ? <> · <Link href="/admin" className="underline">Mon restaurant</Link></> : null}</p>
      </div>
    </div>
  );
}
