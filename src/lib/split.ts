import { splitEqual } from "./money";

export type SplitItem = { id: string; lineTotal: number; seatNumber: number | null };

/** Parts égales : 18 000 F / 6 → 6 × 3 000 F. Le reste (arrondi) va aux premières parts. */
export function splitEqually(total: number, parts: number): number[] {
  return splitEqual(total, parts);
}

/**
 * Par client (siège) : chaque siège paie ses articles ; les articles affectés
 * à la "table entière" sont répartis équitablement entre les sièges présents.
 */
export function splitBySeat(items: SplitItem[], covers: number): { seat: number; amount: number; itemIds: string[] }[] {
  const seats = new Set<number>();
  items.forEach((i) => i.seatNumber && seats.add(i.seatNumber));
  for (let s = 1; s <= covers; s++) seats.add(s);
  const seatList = [...seats].sort((a, b) => a - b);
  const result = seatList.map((seat) => ({ seat, amount: 0, itemIds: [] as string[] }));
  const shared = items.filter((i) => !i.seatNumber);
  for (const item of items) {
    if (item.seatNumber) {
      const r = result.find((x) => x.seat === item.seatNumber)!;
      r.amount += item.lineTotal;
      r.itemIds.push(item.id);
    }
  }
  const sharedTotal = shared.reduce((a, b) => a + b.lineTotal, 0);
  const sharedParts = splitEqual(sharedTotal, seatList.length);
  result.forEach((r, i) => (r.amount += sharedParts[i]));
  return result;
}

/** Par article : somme des articles sélectionnés. */
export function splitByItems(items: SplitItem[], selectedIds: string[]): number {
  const set = new Set(selectedIds);
  return items.filter((i) => set.has(i.id)).reduce((a, b) => a + b.lineTotal, 0);
}

/** Vérifie qu'un montant personnalisé est valide vis-à-vis du reste à payer. */
export function validateCustomAmount(amount: number, remaining: number): boolean {
  return Number.isInteger(amount) && amount > 0 && amount <= remaining;
}
