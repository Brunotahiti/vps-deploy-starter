"use client";

import { usePathname } from "next/navigation";
import { Tabs } from "./common";

export function CatalogTabs() {
  const p = usePathname();
  const tabs = [["/admin/catalog/products", "Produits"], ["/admin/catalog/categories", "Catégories"], ["/admin/catalog/modifiers", "Options & suppléments"], ["/admin/catalog/menus", "Formules"], ["/admin/catalog/tax-rates", "TVA"], ["/admin/catalog/import", "Import CSV"]];
  return <Tabs tabs={tabs.map(([href, label]) => ({ href, label, active: p === href }))} />;
}
