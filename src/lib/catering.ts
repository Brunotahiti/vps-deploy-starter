import { splitTtc } from "./money";

/** Traiteur & événements : types, libellés et calcul des totaux (partagés entre le serveur et l'écran). */

export const EVENT_KINDS = { BUFFET: "Buffet", WEDDING: "Mariage", PRIVATE: "Privatisation", CORPORATE: "Repas d'entreprise", OTHER: "Autre événement" } as const;
export type EventKind = keyof typeof EVENT_KINDS;

export const EVENT_STATUS = {
  DRAFT: { label: "Devis à envoyer", color: "gray" },
  SENT: { label: "Devis envoyé", color: "orange" },
  ACCEPTED: { label: "Confirmé", color: "green" },
  INVOICED: { label: "Facturé", color: "blue" },
  CANCELLED: { label: "Annulé", color: "red" },
} as const;
export type EventStatus = keyof typeof EVENT_STATUS;

export const CATERING_METHODS = { CASH: "Espèces", CARD: "Carte bancaire", CHECK: "Chèque", TRANSFER: "Virement" } as const;
export type CateringMethod = keyof typeof CATERING_METHODS;

/** Ligne de devis : prix unitaire TTC (comme à la carte) et taux de TVA. */
export type EventLine = { label: string; quantity: number; unitPrice: number; taxRateBps: number; taxRateName: string | null };
export type EventTaxRow = { rateBps: number; name: string; ht: number; tax: number; ttc: number };

/** Totaux d'un devis : TTC par ligne, TVA calculée par taux sur le TTC cumulé (pas d'écart d'arrondi entre lignes). */
export function eventTotals(lines: readonly EventLine[]) {
  const byRate = new Map<number, { name: string; ttc: number }>();
  for (const l of lines) {
    const r = byRate.get(l.taxRateBps) ?? { name: l.taxRateName ?? `${l.taxRateBps / 100} %`, ttc: 0 };
    r.ttc += Math.round(l.quantity * l.unitPrice);
    byRate.set(l.taxRateBps, r);
  }
  const taxes: EventTaxRow[] = [...byRate.entries()].sort(([a], [b]) => a - b).map(([rateBps, r]) => ({ rateBps, name: r.name, ...splitTtc(r.ttc, rateBps) }));
  const totalTtc = taxes.reduce((s, t) => s + t.ttc, 0);
  const totalTax = taxes.reduce((s, t) => s + t.tax, 0);
  return { taxes, totalTtc, totalTax, totalHt: totalTtc - totalTax };
}

/** Montant encaissé : acomptes et soldes, remboursements déduits. */
export const paidOf = (payments: readonly { kind: string; amount: number }[]) => payments.reduce((s, p) => s + (p.kind === "REFUND" ? -p.amount : p.amount), 0);
