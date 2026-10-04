/** Réponses de l'API du bar (option Bar). */
export type BarKind = "spirit" | "wine" | "beer" | "soft" | "syrup" | "other";

export const BAR_KIND_LABEL: Record<BarKind, string> = {
  spirit: "Spiritueux", wine: "Vins", beer: "Bières", soft: "Softs et jus", syrup: "Sirops", other: "Autres",
};

export type Bottle = {
  id: string; name: string; barKind: BarKind; unit: string; bottleMl: number | null; stockQty: number; stockMin: number;
  bottles: number; minBottles: number; bottleCost: number; unitCost: number; value: number; low: boolean; out: boolean;
};

export type Cocktail = {
  id: string; name: string; priceTtc: number; imageUrl: string | null; category: { id: string; name: string } | null;
  spec: { glass: string | null; garnish: string | null; method: string | null } | null;
  doses: { ingredientId: string; name: string; unit: string; quantity: number; cost: number }[];
  doseCost: number; hasCard: boolean;
};

export type Tab = { id: string; number: string; customerName: string | null; total: number; paidTotal: number; status: string; openedAt: string; updatedAt: string; items: number; server: string | null };

export type BarReport = {
  from: string; to: string;
  drinks: { quantity: number; revenue: number; top: { name: string; quantity: number; revenue: number }[] };
  happyHour: { quantity: number; discount: number };
  offered: { quantity: number; value: number; byReason: { key: string; count: number; value: number }[]; byPerson: { key: string; count: number; value: number }[] };
  tabs: { count: number; total: number; average: number };
  losses: { value: number; rows: { name: string; unit: string; quantity: number; bottles: number | null; value: number; reason: string | null; at: string; by: string | null }[] };
  cellar: { value: number; low: Bottle[] };
};

const num = (x: number) => (Number.isInteger(x) ? String(x) : x.toLocaleString("fr-FR", { maximumFractionDigits: 2 }));

/** Stock d'une boisson lisible au bar : « 3 bout. + 35 cl », « 24 pièces ». */
export function stockLabel(b: { unit: string; bottleMl: number | null; stockQty: number }): string {
  if (b.unit === "cl" && b.bottleMl) {
    const per = b.bottleMl / 10;
    const full = Math.floor(Math.max(0, b.stockQty) / per + 1e-9);
    const rest = Math.round((Math.max(0, b.stockQty) - full * per) * 10) / 10;
    if (b.stockQty <= 0) return "Vide";
    return [full ? `${full} bout.` : "", rest ? `${num(rest)} cl` : ""].filter(Boolean).join(" + ");
  }
  return `${num(b.stockQty)} ${b.unit === "pce" ? (b.stockQty > 1 ? "pièces" : "pièce") : b.unit}`;
}

/** Quantité d'une dose : « 4 cl », « 1 pièce ». */
export const doseLabel = (d: { unit: string; quantity: number }) => `${num(d.quantity)} ${d.unit === "pce" ? (d.quantity > 1 ? "pièces" : "pièce") : d.unit}`;
