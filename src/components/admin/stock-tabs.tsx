"use client";

import { usePathname } from "next/navigation";
import { Tabs } from "./common";

export function StockTabs() {
  const p = usePathname();
  const tabs = [["/admin/stock", "Ingrédients"], ["/admin/stock/inventory", "Inventaire"], ["/admin/stock/recipes", "Recettes"], ["/admin/stock/suppliers", "Fournisseurs"], ["/admin/stock/orders", "Commandes"], ["/admin/stock/report", "Rapport"]];
  return <Tabs tabs={tabs.map(([href, label]) => ({ href, label, active: p === href }))} />;
}
