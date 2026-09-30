"use client";

import { useState } from "react";
import { useSession } from "@/hooks/use-session";
import { Input } from "@/components/ui/field";
import { Spinner, Card, Badge } from "@/components/ui/misc";
import { Money } from "@/components/money";
import { addDays, formatDateTime, localDay } from "@/lib/dates";
import { PageHeader, Table, Tr, Td, useList } from "@/components/admin/common";
import { Stat, HBars } from "@/components/admin/charts";
import { StockTabs } from "@/components/admin/stock-tabs";
import { MOVEMENT_LABEL, fmtQty, type Movement, type StockReport } from "@/components/admin/stock-types";

/** Rapport stock : consommation, achats, pertes, food cost réel et journal des mouvements. */
export default function StockReportPage() {
  const { currency, timezone } = useSession();
  const today = localDay(new Date(), timezone);
  const [from, setFrom] = useState(addDays(today, -6));
  const [to, setTo] = useState(today);
  const r = useList<StockReport>(["stock", "report", from, to], `/api/stock/report?from=${from}&to=${to}`);
  const moves = useList<Movement[]>(["stock", "movements", from, to], `/api/stock/movements?from=${from}T00:00:00&to=${addDays(to, 1)}T00:00:00&take=300`);
  const d = r.data;
  return (
    <div>
      <PageHeader title="Rapport stock" subtitle="Consommation théorique, achats, pertes et ratio coût matière réel sur la période" action={<div className="flex items-center gap-2"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40!" /><span>→</span><Input type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} className="w-40!" /></div>} />
      <StockTabs />
      {r.isLoading || !d ? <div className="flex justify-center py-10"><Spinner /></div> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="CA HT (payé)" value={<Money amount={d.revenueHt} />} />
            <Stat label="Consommation" value={<Money amount={d.consumption} />} hint="ingrédients vendus (recettes)" accent="#3b82f6" />
            <Stat label="Ratio coût matière réel" value={d.foodCostPct !== null ? `${d.foodCostPct} %` : "—"} hint="consommation / CA HT" accent={d.foodCostPct !== null && d.foodCostPct > 35 ? "#ef4444" : "#22c55e"} />
            <Stat label="Achats" value={<Money amount={d.purchases} />} hint="réceptions de la période" accent="#8b5cf6" />
            <Stat label="Pertes" value={<Money amount={d.losses} />} hint={d.lossPct !== null ? `${d.lossPct} % du CA HT` : "casse, périmés, usage interne"} accent="#f97c3c" />
            <Stat label="Valeur du stock" value={<Money amount={d.stockValue} />} hint={`écarts d'inventaire ${d.inventoryDiff >= 0 ? "+" : ""}${d.inventoryDiff}`} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Ingrédients les plus consommés"><HBars data={d.topConsumed.map((i) => ({ label: i.name, value: i.value, hint: fmtQty(i.qty, i.unit) }))} currency={currency} /></Card>
            <Card title="Pertes par ingrédient"><HBars data={d.topLosses.map((i) => ({ label: i.name, value: i.value, hint: fmtQty(i.qty, i.unit) }))} currency={currency} color="#f97316" /></Card>
          </div>
          <Card title={`Journal des mouvements (${d.movementsCount})`}>
            {moves.isLoading ? <Spinner /> : (
              <div className="max-h-[60vh] overflow-y-auto">
                <Table head={["Date", "Ingrédient", "Type", "Quantité", "Valeur", "Motif", "Par"]}>
                  {moves.data?.map((m) => <Tr key={m.id}><Td className="whitespace-nowrap text-xs">{formatDateTime(m.createdAt, timezone)}</Td><Td className="font-semibold">{m.ingredient.name}</Td><Td><Badge color={m.kind === "SALE" ? "blue" : m.kind === "PURCHASE" ? "green" : m.kind === "INVENTORY" ? "purple" : m.kind === "ADJUSTMENT" ? "gray" : "red"}>{MOVEMENT_LABEL[m.kind]}</Badge></Td><Td className={`tabular-nums font-semibold ${m.quantity < 0 ? "text-red-600" : "text-green-600"}`}>{m.quantity > 0 ? "+" : ""}{fmtQty(m.quantity, m.ingredient.unit)}</Td><Td>{m.value !== null ? <Money amount={m.value} /> : "—"}</Td><Td className="text-xs">{m.reason ?? ""}</Td><Td className="text-xs">{m.user?.displayName || m.user?.firstName || "système"}</Td></Tr>)}
                  {moves.data?.length === 0 ? <Tr><Td className="py-6 text-center text-muted">Aucun mouvement sur la période</Td></Tr> : null}
                </Table>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
