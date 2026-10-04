"use client";

import { useState } from "react";
import { useSession } from "@/hooks/use-session";
import { PageHeader } from "@/components/admin/common";
import { Empty } from "@/components/ui/misc";
import { BarReportView, Cellar, CocktailCards, HappyHourSettings } from "@/components/bar/admin-bar";

type Tab = "happy" | "cards" | "cellar" | "report";

/** Bar (option) : happy hour, fiches cocktails, cave du bar et rapport. Les ardoises se tiennent à la caisse (portail Salle → Bar). */
export default function BarAdminPage() {
  const { can, hasOption } = useSession();
  const manage = can("bar.manage");
  const allowed = hasOption("bar") && (manage || can("bar.use"));
  const [tab, setTab] = useState<Tab>(manage ? "happy" : "cellar");
  if (!allowed) return <Empty title="Bar" hint="Cette option se débloque dans Gestion → Options." />;
  const tabs: { key: Tab; label: string }[] = [
    ...(manage ? [{ key: "happy" as Tab, label: "Happy hour" }, { key: "cards" as Tab, label: "Fiches cocktails" }] : []),
    { key: "cellar", label: "Cave du bar" },
    ...(manage ? [{ key: "report" as Tab, label: "Rapport du bar" }] : []),
  ];
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Bar" subtitle="Happy hour, fiches cocktails, cave à boissons et rapport du bar. Les ardoises se tiennent à la caisse, onglet Bar." />
      <div role="tablist" className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
        {tabs.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} className={`touch shrink-0 rounded-full px-4 py-2 text-sm font-bold transition ${tab === t.key ? "bg-brand text-white shadow-glow" : "surface-2 text-muted hover:text-[var(--text)]"}`}>{t.label}</button>
        ))}
      </div>
      {tab === "happy" && manage ? <HappyHourSettings /> : null}
      {tab === "cards" && manage ? <CocktailCards /> : null}
      {tab === "cellar" ? <Cellar manage={manage} /> : null}
      {tab === "report" && manage ? <BarReportView /> : null}
    </div>
  );
}
