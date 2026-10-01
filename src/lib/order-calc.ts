import { roundHalfUp, splitTtc } from "./money";

/** Ligne de commande minimale pour le calcul des totaux (indépendant de Prisma). */
export type CalcLine = {
  quantity: number;
  unitPrice: number;       // TTC unitaire
  modifiersTotal: number;  // TTC par unité (somme des options)
  discountAmount: number;  // remise ligne (TTC)
  taxRateBps: number;
  voided?: boolean;
  isComponent?: boolean;   // composant de formule : inclus dans le parent, prix propre = supplément
};

export type LineTotals = { lineTotal: number; taxAmount: number; ht: number };

export function computeLine(line: CalcLine): LineTotals {
  if (line.voided) return { lineTotal: 0, taxAmount: 0, ht: 0 };
  const gross = (line.unitPrice + line.modifiersTotal) * line.quantity;
  const lineTotal = Math.max(0, gross - line.discountAmount);
  const { ht, tax } = splitTtc(lineTotal, line.taxRateBps);
  return { lineTotal, taxAmount: tax, ht };
}

export type TaxBreakdownEntry = { rateBps: number; name: string; ht: number; tax: number; ttc: number };

export type OrderTotals = {
  subtotal: number;      // somme des lignes TTC après remises lignes
  discountTotal: number; // remise globale (répartie)
  total: number;         // net à payer TTC
  taxTotal: number;
  htTotal: number;
  breakdown: TaxBreakdownEntry[];
};

/**
 * Totaux d'une commande. La remise globale est répartie au prorata sur les
 * lignes afin que la ventilation TVA reste exacte (HT + TVA = TTC).
 */
export function computeOrderTotals(
  lines: (CalcLine & { taxRateName?: string | null })[],
  globalDiscount = 0,
): OrderTotals {
  const active = lines.filter((l) => !l.voided);
  const lineTotals = active.map((l) => computeLine(l).lineTotal);
  const subtotal = lineTotals.reduce((a, b) => a + b, 0);
  const discountTotal = Math.min(Math.max(0, globalDiscount), subtotal);

  // Répartition de la remise globale au prorata (la dernière ligne absorbe l'arrondi)
  const allocated: number[] = [];
  let remaining = discountTotal;
  active.forEach((_, i) => {
    const isLast = i === active.length - 1;
    const share = isLast || subtotal === 0 ? remaining : roundHalfUp((discountTotal * lineTotals[i]) / subtotal);
    const capped = Math.min(share, lineTotals[i], remaining);
    allocated.push(capped);
    remaining -= capped;
  });
  // Reste d'arrondi non absorbé (dernière ligne trop petite, ex. composant de formule à 0 F) :
  // réparti sur les lignes qui ont encore de la marge, de la plus grande à la plus petite
  if (remaining > 0) {
    const byRoom = allocated.map((_, i) => i).sort((a, b) => (lineTotals[b] - allocated[b]) - (lineTotals[a] - allocated[a]));
    for (const i of byRoom) {
      if (remaining <= 0) break;
      const take = Math.min(lineTotals[i] - allocated[i], remaining);
      allocated[i] += take;
      remaining -= take;
    }
  }

  const byRate = new Map<number, TaxBreakdownEntry>();
  let taxTotal = 0;
  let total = 0;
  active.forEach((l, i) => {
    const ttc = lineTotals[i] - allocated[i];
    const { ht, tax } = splitTtc(ttc, l.taxRateBps);
    total += ttc;
    taxTotal += tax;
    const entry = byRate.get(l.taxRateBps) ?? { rateBps: l.taxRateBps, name: l.taxRateName ?? `${l.taxRateBps / 100} %`, ht: 0, tax: 0, ttc: 0 };
    entry.ht += ht;
    entry.tax += tax;
    entry.ttc += ttc;
    byRate.set(l.taxRateBps, entry);
  });

  return {
    subtotal,
    discountTotal,
    total,
    taxTotal,
    htTotal: total - taxTotal,
    breakdown: [...byRate.values()].sort((a, b) => b.rateBps - a.rateBps),
  };
}
