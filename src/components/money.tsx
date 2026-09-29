"use client";

import { formatMoney } from "@/lib/money";
import { useSession } from "@/hooks/use-session";

export function Money({ amount, className = "", currency }: { amount: number; className?: string; currency?: string }) {
  const { currency: cur } = useSession();
  return <span className={`tabular-nums ${className}`}>{formatMoney(amount, currency ?? cur)}</span>;
}
