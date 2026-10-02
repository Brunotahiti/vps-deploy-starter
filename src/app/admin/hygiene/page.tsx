"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, Sparkles } from "lucide-react";
import { api } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { PageHeader, useAction } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input } from "@/components/ui/field";
import { Empty, Spinner } from "@/components/ui/misc";
import { HygieneCleaningPlan, HygieneEquipmentSettings, HygieneReadings, HygieneToday, HygieneTrace, type Today } from "@/components/admin/hygiene";
import { addDays, localDay } from "@/lib/dates";

type Tab = "today" | "readings" | "cleaning" | "trace" | "settings";

/** Hygiène & HACCP (option) : la journée d'hygiène sur un écran, pensé pour le téléphone en cuisine. */
export default function HygienePage() {
  const { can, hasOption, timezone } = useSession();
  const act = useAction();
  const manage = can("hygiene.manage");
  const allowed = hasOption("hygiene") && (can("hygiene.record") || manage);
  const [tab, setTab] = useState<Tab>("today");
  const [register, setRegister] = useState<{ from: string; to: string } | null>(null);
  const today = useQuery({ queryKey: ["hygiene", "today"], queryFn: () => api.get<Today>("/api/hygiene/today"), enabled: allowed, refetchInterval: 60_000 });

  if (!allowed) return <Empty title="Hygiène & HACCP" hint="Cette option se débloque dans Gestion → Options." />;
  const setup = () => act(() => api.post("/api/hygiene/setup"), { success: "Plan type créé : adaptez-le à votre restaurant", invalidate: [["hygiene"]] });
  const c = today.data?.counts;
  const tabs: { key: Tab; label: string; badge?: number }[] = [
    { key: "today", label: "Aujourd'hui", badge: c ? c.readingsDue + c.cleaningDue + c.expired : 0 },
    { key: "readings", label: "Températures" },
    { key: "cleaning", label: "Nettoyage" },
    { key: "trace", label: "Traçabilité" },
    ...(manage ? [{ key: "settings" as Tab, label: "Équipements" }] : []),
  ];
  const now = localDay(new Date(), timezone);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Hygiène & HACCP" subtitle="Relevés, nettoyage et traçabilité : votre registre se remplit au fil de la journée."
        action={manage ? <Button variant="secondary" onClick={() => setRegister({ from: addDays(now, -29), to: now })} data-testid="open-register"><FileText className="h-4 w-4" />Registre</Button> : null} />
      <div role="tablist" className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
        {tabs.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} className={`touch flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold transition ${tab === t.key ? "bg-brand text-white shadow-glow" : "surface-2 text-muted hover:text-[var(--text)]"}`}>
            {t.label}{t.badge ? <span className={`rounded-full px-1.5 text-xs ${tab === t.key ? "bg-white/25" : "bg-orange-500 text-white"}`}>{t.badge}</span> : null}
          </button>
        ))}
      </div>

      {tab === "today" ? (
        today.isLoading || !today.data ? <Spinner /> : !today.data.setupDone ? (
          <section className="card flex flex-col items-start gap-3 p-6" data-testid="hygiene-setup">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-400 to-cyan-700 text-white"><Sparkles className="h-6 w-6" /></span>
            <h2 className="text-xl font-extrabold">Démarrez en un geste</h2>
            <p className="max-w-xl text-sm text-muted">Le plan type crée un réfrigérateur, un congélateur et les nettoyages courants d&apos;une cuisine et d&apos;une salle. Vous les modifiez ensuite comme vous voulez.</p>
            {manage ? <Button size="lg" onClick={setup} data-testid="hygiene-setup-btn"><Sparkles className="h-5 w-5" />Créer le plan type</Button> : <p className="text-sm font-semibold">Votre responsable doit d&apos;abord créer le plan d&apos;hygiène.</p>}
          </section>
        ) : <HygieneToday data={today.data} />
      ) : null}
      {tab === "readings" ? <HygieneReadings /> : null}
      {tab === "cleaning" ? <HygieneCleaningPlan /> : null}
      {tab === "trace" ? <HygieneTrace /> : null}
      {tab === "settings" && manage ? <HygieneEquipmentSettings /> : null}

      {register ? (
        <Modal open onClose={() => setRegister(null)} size="sm" title="Registre d'hygiène" footer={
          <a className="touch flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-brand text-base font-semibold text-white shadow-glow" href={`/api/hygiene/register?from=${register.from}&to=${register.to}`} target="_blank" rel="noopener" data-testid="register-open"><FileText className="h-5 w-5" />Ouvrir le registre</a>
        }>
          <p className="mb-3 text-sm text-muted">Relevés, nettoyages, traçabilité et non-conformités de la période : à imprimer ou à enregistrer en PDF pour un contrôle sanitaire (trois mois au plus).</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Du"><Input type="date" value={register.from} max={register.to} onChange={(e) => setRegister({ ...register, from: e.target.value })} aria-label="Début" /></Field>
            <Field label="Au"><Input type="date" value={register.to} min={register.from} max={now} onChange={(e) => setRegister({ ...register, to: e.target.value })} aria-label="Fin" /></Field>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
