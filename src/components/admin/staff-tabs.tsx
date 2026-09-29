"use client";

import { usePathname } from "next/navigation";
import { Tabs } from "./common";

export function StaffTabs() {
  const p = usePathname();
  const tabs = [["/admin/staff", "Employés"], ["/admin/staff/shifts", "Planning"], ["/admin/staff/entries", "Pointages"], ["/admin/staff/summary", "Heures & coût"]];
  return <Tabs tabs={tabs.map(([href, label]) => ({ href, label, active: p === href }))} />;
}
