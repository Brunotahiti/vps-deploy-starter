import type { Tx } from "@/server/db";

/*
 * Vin au verre et en carafe (option Cave à vin) : chaque verre vendu est versé de la plus ancienne bouteille ouverte ;
 * une bouteille vide se ferme et la suivante s'ouvre toute seule. Une annulation reverse le vin dans la bouteille.
 * Le stock (en cl) est déjà décompté par la recette du produit : ici, on suit seulement les bouteilles ouvertes.
 */
export type Pour = { wineId: string; ml: number; bottleMl: number };

export async function pourWine(tx: Tx, establishmentId: string, pours: Pour[], direction: -1 | 1, userId: string | null) {
  for (const p of pours) {
    if (!(p.ml > 0) || !(p.bottleMl > 0)) continue;
    // Une vente à la fois par vin : deux envois simultanés ne versent pas deux fois le même fond de bouteille
    await tx.$queryRaw`SELECT 1 FROM "wines" WHERE "id" = ${p.wineId}::uuid FOR UPDATE`;
    if (direction < 0) await serve(tx, establishmentId, p, userId);
    else await giveBack(tx, p);
  }
}

async function serve(tx: Tx, establishmentId: string, p: Pour, userId: string | null) {
  let left = p.ml;
  const open = await tx.wineOpenBottle.findMany({ where: { wineId: p.wineId, closedAt: null }, orderBy: { openedAt: "asc" } });
  for (const b of open) {
    if (left <= 0) break;
    const take = Math.min(b.remainingMl, left);
    left -= take;
    const remainingMl = b.remainingMl - take;
    await tx.wineOpenBottle.update({ where: { id: b.id }, data: { remainingMl, ...(remainingMl <= 0 ? { closedAt: new Date(), closedReason: "FINISHED" } : {}) } });
  }
  while (left > 0) {
    const take = Math.min(p.bottleMl, left);
    left -= take;
    const remainingMl = p.bottleMl - take;
    await tx.wineOpenBottle.create({ data: { establishmentId, wineId: p.wineId, openedById: userId, remainingMl, ...(remainingMl <= 0 ? { closedAt: new Date(), closedReason: "FINISHED" } : {}) } });
  }
}

async function giveBack(tx: Tx, p: Pour) {
  let left = p.ml;
  const open = await tx.wineOpenBottle.findMany({ where: { wineId: p.wineId, closedAt: null }, orderBy: { openedAt: "desc" } });
  for (const b of open) {
    if (left <= 0) break;
    const add = Math.min(p.bottleMl - b.remainingMl, left);
    if (add <= 0) continue;
    left -= add;
    await tx.wineOpenBottle.update({ where: { id: b.id }, data: { remainingMl: b.remainingMl + add } });
  }
  // Reste à reverser : la dernière bouteille terminée est rouverte (jamais une bouteille jetée)
  while (left > 0) {
    const last = await tx.wineOpenBottle.findFirst({ where: { wineId: p.wineId, closedReason: "FINISHED" }, orderBy: { closedAt: "desc" } });
    if (!last) break;
    const add = Math.min(p.bottleMl, left);
    left -= add;
    await tx.wineOpenBottle.update({ where: { id: last.id }, data: { remainingMl: add, closedAt: null, closedReason: null } });
  }
}
