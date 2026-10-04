import type { Tx } from "@/server/db";
import { activeHappyHour, normalizeBarSettings } from "@/lib/happy-hour";

export { activeHappyHour, isHappyHourOn, normalizeBarSettings, type BarSettings, type HappyHour } from "@/lib/happy-hour";

/** Happy hour applicable à l'ajout d'un produit (option Bar débloquée), ou null. */
export async function happyHourFor(tx: Tx, establishmentId: string, product: { id: string; categoryId: string | null }, at = new Date()) {
  const est = await tx.establishment.findUniqueOrThrow({ where: { id: establishmentId }, select: { settings: true, timezone: true, organization: { select: { options: true } } } });
  if (!est.organization.options.includes("bar")) return null;
  return activeHappyHour(normalizeBarSettings(((est.settings ?? {}) as { bar?: unknown }).bar), est.timezone, at, product);
}

