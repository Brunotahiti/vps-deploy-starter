"use client";

import { useState } from "react";
import { useSession } from "@/hooks/use-session";
import { PageHeader } from "@/components/admin/common";
import { Empty } from "@/components/ui/misc";
import { OpenBottles, WineCellar, WineListView, WineReportView } from "@/components/wine/wine-ui";

type Tab = "cellar" | "open" | "list" | "report";

/** Cave à vin (option) : la cave par emplacement, le vin au verre, la carte des vins et le rapport. */
export default function WineAdminPage() {
  const { can, hasOption } = useSession();
  const manage = can("wine.manage");
  const allowed = hasOption("wine") && (manage || can("wine.use"));
  const [tab, setTab] = useState<Tab>("cellar");
  if (!allowed) return <Empty title="Cave à vin" hint="Cette option se débloque dans Gestion → Options." />;
  const tabs: { key: Tab; label: string }[] = [
    { key: "cellar", label: "Cave" },
    { key: "open", label: "Vin au verre" },
    { key: "list", label: "Carte des vins" },
    ...(manage ? [{ key: "report" as Tab, label: "Rapport" }] : []),
  ];
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Cave à vin" subtitle="Vos vins, leurs emplacements et leur stock, le service au verre, la carte des vins et les ventes. À la caisse, l'onglet Cave aide l'équipe à conseiller." />
      <div role="tablist" className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
        {tabs.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} className={`touch shrink-0 rounded-full px-4 py-2 text-sm font-bold transition ${tab === t.key ? "bg-brand text-white shadow-glow" : "surface-2 text-muted hover:text-[var(--text)]"}`}>{t.label}</button>
        ))}
      </div>
      {tab === "cellar" ? <WineCellar manage={manage} /> : null}
      {tab === "open" ? <OpenBottles /> : null}
      {tab === "list" ? <WineListView manage={manage} /> : null}
      {tab === "report" && manage ? <WineReportView /> : null}
    </div>
  );
}
