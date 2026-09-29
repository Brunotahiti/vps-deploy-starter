/**
 * Gestion des montants monétaires.
 * Tous les montants sont des entiers dans l'unité mineure de la devise.
 * XPF (F CFP) : exposant 0 → 1 = 1 F. EUR : exposant 2 → 100 = 1,00 €.
 */

export type CurrencyInfo = {
  code: string;
  symbol: string;
  exponent: number;
  locale: string;
};

export const CURRENCIES: Record<string, CurrencyInfo> = {
  XPF: { code: "XPF", symbol: "F", exponent: 0, locale: "fr-PF" },
  EUR: { code: "EUR", symbol: "€", exponent: 2, locale: "fr-FR" },
  USD: { code: "USD", symbol: "$", exponent: 2, locale: "en-US" },
  NZD: { code: "NZD", symbol: "NZ$", exponent: 2, locale: "en-NZ" },
};

export function currencyInfo(code: string): CurrencyInfo {
  return CURRENCIES[code] ?? { code, symbol: code, exponent: 2, locale: "fr-FR" };
}

/** Formate un montant : 2450 → "2 450 F" (XPF). Sans décimales pour XPF. */
export function formatMoney(amount: number, currency = "XPF"): string {
  const info = currencyInfo(currency);
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  const major = Math.floor(abs / 10 ** info.exponent);
  const minor = abs % 10 ** info.exponent;
  const majorStr = major.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const minorStr = info.exponent > 0 ? "," + minor.toString().padStart(info.exponent, "0") : "";
  return `${sign}${majorStr}${minorStr} ${info.symbol}`;
}

/** Formate un nombre en pourcentage depuis des points de base : 1600 → "16 %". */
export function formatBps(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2).replace(".", ",")} %`;
}

/** Arrondi bancaire "half up" pour entiers. */
export function roundHalfUp(value: number): number {
  return Math.sign(value) * Math.floor(Math.abs(value) + 0.5);
}

/** Décompose un TTC en HT + TVA selon un taux en bps. TVA = TTC − HT. */
export function splitTtc(ttc: number, rateBps: number): { ht: number; tax: number; ttc: number } {
  if (rateBps <= 0) return { ht: ttc, tax: 0, ttc };
  const ht = roundHalfUp((ttc * 10000) / (10000 + rateBps));
  return { ht, tax: ttc - ht, ttc };
}

/** Répartit un montant en n parts entières égales, le reste est distribué aux premières parts. */
export function splitEqual(amount: number, parts: number): number[] {
  if (parts <= 0) throw new Error("parts must be > 0");
  const base = Math.floor(amount / parts);
  const rest = amount - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < rest ? 1 : 0));
}

/** Applique un pourcentage (bps) à un montant, arrondi à l'unité. */
export function applyBps(amount: number, bps: number): number {
  return roundHalfUp((amount * bps) / 10000);
}
