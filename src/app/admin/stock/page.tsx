"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Select, Toggle } from "@/components/ui/field";
import { Spinner, Badge } from "@/components/ui/misc";
import { Money } from "@/components/money";
import { formatDateTime } from "@/lib/dates";
import { PageHeader, Table, Tr, Td, useAction, useList } from "@/components/admin/common";
import { Stat } from "@/components/admin/charts";
import { StockTabs } from "@/components/admin/stock-tabs";
import { MOVEMENT_LABEL, UNIT_OPTIONS, fmtQty, type Ingredient, type Movement, type StockAlerts } from "@/components/admin/stock-types";

type Form = { id?: string; name: string; unit: string; stockMin: string; avgCost: string; isCritical: boolean };
type MoveForm = { ingredient: Ingredient; kind: "LOSS" | "BREAKAGE" | "INTERNAL_USE" | "ADJUSTMENT" | "PURCHASE"; quantity: string; unitCost: string; reason: string };

export default function StockPage() {
  const { can, timezone } = useSession();
  const act = useAction();
  const [search, setSearch] = useState("");
  const [onlyAlerts, setOnlyAlerts] = useState(false);
  const [edit, setEdit] = useState<Form | null>(null);
  const [move, setMove] = useState<MoveForm | null>(null);
  const [history, setHistory] = useState<Ingredient | null>(null);
  const q = useList<Ingredient[]>(["stock", "ingredients"], "/api/stock/ingredients");
  const alerts = useList<StockAlerts>(["stock", "alerts"], "/api/stock/alerts");
  const hist = useList<Movement[]>(["stock", "movements", history?.id ?? ""], `/api/stock/ingredients/${history?.id}/movements?take=100`, !!history);
  const manage = can("stock.manage");
  const inv = ["stock"];

  const rows = useMemo(() => (q.data ?? []).filter((i) => (!onlyAlerts || i.belowMin) && (!search || i.name.toLowerCase().includes(search.toLowerCase()))), [q.data, onlyAlerts, search]);
  const stockValue = (q.data ?? []).reduce((a, i) => a + i.value, 0);

  const save = async () => {
    if (!edit) return;
    const body = { name: edit.name, unit: edit.unit, stockMin: Number(edit.stockMin || 0), avgCost: Number(edit.avgCost || 0), isCritical: edit.isCritical };
    const r = await act(() => (edit.id ? api.patch(`/api/stock/ingredients/${edit.id}`, body) : api.post("/api/stock/ingredients", body)), { success: "Ingrédient enregistré", invalidate: [inv] });
    if (r) setEdit(null);
  };
  const saveMove = async () => {
    if (!move) return;
    const r = await act(() => api.post("/api/stock/movements", { ingredientId: move.ingredient.id, kind: move.kind, quantity: Number(move.quantity), unitCost: move.kind === "PURCHASE" && move.unitCost ? Number(move.unitCost) : null, reason: move.reason || null }), { success: "Mouvement enregistré", invalidate: [inv, ["pos-catalog"], ["products"]] });
    if (r) setMove(null);
  };

  return (
    <div>
      <PageHeader title="Stocks & achats" subtitle="Ingrédients et préparations maison, seuils d'alerte, pertes et coût matière" action={manage ? <Button onClick={() => setEdit({ name: "", unit: "pce", stockMin: "0", avgCost: "0", isCritical: false })}>Nouvel ingrédient</Button> : null} />
      <StockTabs />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Valeur du stock" value={<Money amount={stockValue} />} hint="au coût moyen" />
        <Stat label="Ingrédients" value={q.data?.length ?? "…"} hint={`${(q.data ?? []).filter((i) => i.isCritical).length} critiques`} accent="#3b82f6" />
        <Stat label="Sous le seuil" value={alerts.data?.ingredients.length ?? "…"} hint={`${alerts.data?.ingredients.filter((i) => i.out).length ?? 0} en rupture`} accent="#f97c3c" />
        <Stat label="Produits indisponibles" value={alerts.data?.productsUnavailable.length ?? "…"} hint="rupture automatique" accent="#ef4444" />
      </div>
      {alerts.data && alerts.data.productsUnavailable.length > 0 ? <p className="mb-3 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300"><b>Indisponibles en caisse (rupture) :</b> {alerts.data.productsUnavailable.map((p) => p.name).join(", ")}</p> : null}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher…" className="w-56!" />
        <Toggle checked={onlyAlerts} onChange={setOnlyAlerts} label="Sous le seuil uniquement" />
      </div>
      {q.isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : (
        <Table head={["Ingrédient", "Stock", "Seuil", "Coût moyen", "Valeur", "Recettes", ""]}>
          {rows.map((i) => (
            <Tr key={i.id}>
              <Td><span className="font-semibold">{i.name}</span>{i.isCritical ? <Badge color="purple">critique</Badge> : null}{i.isPreparation ? <Badge color="teal">préparation</Badge> : null}<span className="block text-xs text-muted">{i.unit}</span></Td>
              <Td><span className={`font-bold tabular-nums ${i.stockQty <= 0 ? "text-red-600" : i.belowMin ? "text-orange-600" : ""}`}>{fmtQty(i.stockQty, i.unit)}</span>{i.stockQty <= 0 ? <Badge color="red">rupture</Badge> : i.belowMin ? <Badge color="orange">à commander</Badge> : null}</Td>
              <Td className="tabular-nums">{fmtQty(i.stockMin, i.unit)}</Td><Td><Money amount={i.avgCost} /> / {i.unit}</Td><Td className="font-semibold"><Money amount={i.value} /></Td><Td>{i._count.recipeLines}{i._count.usedIn ? <span className="block text-[11px] text-muted">+ {i._count.usedIn} prépa.</span> : null}</Td>
              <Td className="space-x-3 whitespace-nowrap">
                <button onClick={() => setHistory(i)} className="text-xs font-semibold text-lagon-600">Historique</button>
                {manage ? <><button onClick={() => setMove({ ingredient: i, kind: "LOSS", quantity: "", unitCost: "", reason: "" })} className="text-xs font-semibold text-corail-500">Perte / ajust.</button><button onClick={() => setEdit({ id: i.id, name: i.name, unit: i.unit, stockMin: String(i.stockMin), avgCost: String(i.avgCost), isCritical: i.isCritical })} className="text-xs font-semibold text-lagon-600">Modifier</button><button onClick={() => confirm(`Archiver « ${i.name} » ?`) && act(() => api.delete(`/api/stock/ingredients/${i.id}`), { success: "Archivé", invalidate: [inv] })} className="text-xs font-semibold text-red-600">Archiver</button></> : null}
              </Td>
            </Tr>
          ))}
          {rows.length === 0 ? <Tr><Td className="py-8 text-center text-muted">{q.data?.length ? "Aucun ingrédient ne correspond" : "Aucun ingrédient : créez vos ingrédients, puis les recettes de vos produits pour décrémenter le stock automatiquement à chaque envoi en cuisine."}</Td></Tr> : null}
        </Table>
      )}

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Modifier l'ingrédient" : "Nouvel ingrédient"} size="sm" footer={<Button className="w-full" disabled={!edit?.name} onClick={save}>Enregistrer</Button>}>
        {edit ? <div className="space-y-3">
          <Field label="Nom"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Thon rouge, Pain burger, Hinano 33 cl…" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Unité"><Select value={edit.unit} onChange={(e) => setEdit({ ...edit, unit: e.target.value })}>{UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}</Select></Field>
            <Field label="Seuil d'alerte"><Input type="number" step="0.001" value={edit.stockMin} onChange={(e) => setEdit({ ...edit, stockMin: e.target.value })} /></Field>
          </div>
          <Field label="Coût moyen par unité (F)" hint="Mis à jour automatiquement à chaque réception d'achat"><Input type="number" value={edit.avgCost} onChange={(e) => setEdit({ ...edit, avgCost: e.target.value })} /></Field>
          <Toggle checked={edit.isCritical} onChange={(v) => setEdit({ ...edit, isCritical: v })} label="Critique : à zéro, les produits qui l'utilisent passent indisponibles en caisse" />
        </div> : null}
      </Modal>

      <Modal open={!!move} onClose={() => setMove(null)} title={move ? `Mouvement — ${move.ingredient.name}` : ""} size="sm" footer={<Button className="w-full" disabled={!move?.quantity || Number(move.quantity) === 0 || (["LOSS", "BREAKAGE", "INTERNAL_USE"].includes(move?.kind ?? "") && !move?.reason)} onClick={saveMove}>Enregistrer</Button>}>
        {move ? <div className="space-y-3">
          <p className="text-sm text-muted">Stock actuel : <b>{fmtQty(move.ingredient.stockQty, move.ingredient.unit)}</b></p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{(["LOSS", "BREAKAGE", "INTERNAL_USE", "ADJUSTMENT", "PURCHASE"] as const).map((k) => <button key={k} type="button" onClick={() => setMove({ ...move, kind: k })} className={`touch h-10 rounded-lg text-xs font-bold ${move.kind === k ? "bg-lagon-600 text-white" : "surface-2"}`}>{MOVEMENT_LABEL[k]}</button>)}</div>
          <Field label={move.kind === "ADJUSTMENT" ? "Quantité (+ ou −)" : `Quantité (${move.ingredient.unit})`}><Input type="number" step="0.001" value={move.quantity} onChange={(e) => setMove({ ...move, quantity: e.target.value })} /></Field>
          {move.kind === "PURCHASE" ? <Field label="Coût unitaire (F)" hint="Laisser vide pour garder le coût moyen"><Input type="number" value={move.unitCost} onChange={(e) => setMove({ ...move, unitCost: e.target.value })} /></Field> : null}
          <Field label={move.kind === "ADJUSTMENT" || move.kind === "PURCHASE" ? "Motif (facultatif)" : "Motif (obligatoire)"}><Input value={move.reason} onChange={(e) => setMove({ ...move, reason: e.target.value })} placeholder="Périmé, tombé, repas du personnel…" /></Field>
        </div> : null}
      </Modal>

      <Modal open={!!history} onClose={() => setHistory(null)} title={history ? `Mouvements — ${history.name}` : ""} size="lg">
        {hist.isLoading ? <div className="flex justify-center py-6"><Spinner /></div> : (
          <Table head={["Date", "Type", "Quantité", "Coût unit.", "Motif", "Par"]}>
            {hist.data?.map((m) => <Tr key={m.id}><Td className="whitespace-nowrap text-xs">{formatDateTime(m.createdAt, timezone)}</Td><Td><Badge color={m.kind === "SALE" ? "blue" : m.kind === "PURCHASE" ? "green" : m.kind === "PRODUCTION" ? "teal" : m.kind === "INVENTORY" ? "purple" : m.kind === "ADJUSTMENT" ? "gray" : "red"}>{MOVEMENT_LABEL[m.kind]}</Badge></Td><Td className={`font-semibold tabular-nums ${m.quantity < 0 ? "text-red-600" : "text-green-600"}`}>{m.quantity > 0 ? "+" : ""}{fmtQty(m.quantity, m.ingredient.unit)}</Td><Td>{m.unitCost !== null ? <Money amount={m.unitCost} /> : "—"}</Td><Td className="text-xs">{m.reason ?? ""}</Td><Td className="text-xs">{m.user?.displayName || m.user?.firstName || "système"}</Td></Tr>)}
            {hist.data?.length === 0 ? <Tr><Td className="py-6 text-center text-muted">Aucun mouvement</Td></Tr> : null}
          </Table>
        )}
      </Modal>
    </div>
  );
}
