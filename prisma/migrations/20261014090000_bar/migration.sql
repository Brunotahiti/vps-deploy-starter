-- Option payante « Bar » : ardoises au comptoir, happy hour, verres offerts, fiches cocktails, cave du bar

-- Cave du bar : boissons (spiritueux, vins, bières, softs, sirops) et contenance d'une bouteille
ALTER TABLE "ingredients" ADD COLUMN     "bar_kind" TEXT,
ADD COLUMN     "bottle_ml" INTEGER;

-- Remise d'une ligne : happy hour ou verre offert (motif et auteur), en points de base
ALTER TABLE "order_items" ADD COLUMN     "discount_bps" INTEGER,
ADD COLUMN     "discount_by_id" UUID,
ADD COLUMN     "discount_kind" TEXT,
ADD COLUMN     "discount_note" TEXT;

-- Ardoise au comptoir
ALTER TABLE "orders" ADD COLUMN     "is_tab" BOOLEAN NOT NULL DEFAULT false;

-- Fiche cocktail : verre, garniture, préparation
ALTER TABLE "products" ADD COLUMN     "bar_spec" JSONB;

-- CreateIndex
CREATE INDEX "orders_establishment_id_is_tab_status_idx" ON "orders"("establishment_id", "is_tab", "status");

-- Droits : utiliser le bar (ardoises, fiches, offerts, casse) et le gérer (happy hour, cave, rapport)
INSERT INTO "permissions" ("key", "group", "description") VALUES
  ('bar.use', 'Bar', 'Utiliser le bar : ardoises, fiches cocktails, casse'),
  ('bar.manage', 'Bar', 'Gérer le bar : happy hour, cave, fiches cocktails, rapport du bar')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r."id", k.key FROM "roles" r
CROSS JOIN (VALUES ('bar.use'), ('bar.manage')) AS k(key)
WHERE r."is_system" AND r."key" IN ('admin', 'manager')
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r."id", 'bar.use' FROM "roles" r
WHERE r."is_system" AND r."key" IN ('server', 'cashier', 'bartender')
ON CONFLICT DO NOTHING;
