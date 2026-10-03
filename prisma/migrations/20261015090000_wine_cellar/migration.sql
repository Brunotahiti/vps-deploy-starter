-- Option payante « Cave à vin » : fiches vins, cave et emplacements, vin au verre (bouteilles ouvertes), carte des vins et accords
ALTER TABLE "products" ADD COLUMN     "wine_id" UUID,
ADD COLUMN     "wine_serving" TEXT,
ADD COLUMN     "wine_serving_ml" INTEGER;

-- CreateTable
CREATE TABLE "wines" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "producer" TEXT,
    "appellation" TEXT,
    "region" TEXT,
    "country" TEXT,
    "color" TEXT NOT NULL,
    "vintage" INTEGER,
    "grapes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "abv" DOUBLE PRECISION,
    "is_organic" BOOLEAN NOT NULL DEFAULT false,
    "tasting_notes" TEXT,
    "pairing_notes" TEXT,
    "serving_temp" TEXT,
    "drink_from" INTEGER,
    "drink_until" INTEGER,
    "location" TEXT,
    "image_url" TEXT,
    "keep_days" INTEGER,
    "paired_product_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "show_on_list" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wine_open_bottles" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "wine_id" UUID NOT NULL,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opened_by_id" UUID,
    "remaining_ml" INTEGER NOT NULL,
    "closed_at" TIMESTAMP(3),
    "closed_reason" TEXT,
    "discarded_ml" INTEGER,
    "closed_by_id" UUID,

    CONSTRAINT "wine_open_bottles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wines_ingredient_id_key" ON "wines"("ingredient_id");

-- CreateIndex
CREATE INDEX "wines_establishment_id_color_idx" ON "wines"("establishment_id", "color");

-- CreateIndex
CREATE INDEX "wine_open_bottles_establishment_id_closed_at_idx" ON "wine_open_bottles"("establishment_id", "closed_at");

-- CreateIndex
CREATE INDEX "wine_open_bottles_wine_id_closed_at_idx" ON "wine_open_bottles"("wine_id", "closed_at");

-- CreateIndex
CREATE INDEX "products_wine_id_idx" ON "products"("wine_id");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_wine_id_fkey" FOREIGN KEY ("wine_id") REFERENCES "wines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wines" ADD CONSTRAINT "wines_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wines" ADD CONSTRAINT "wines_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wine_open_bottles" ADD CONSTRAINT "wine_open_bottles_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wine_open_bottles" ADD CONSTRAINT "wine_open_bottles_wine_id_fkey" FOREIGN KEY ("wine_id") REFERENCES "wines"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Droits : consulter la cave et servir au verre (fiches, accords, bouteilles ouvertes) ; la gérer (fiches, prix, réceptions, inventaire, carte, rapport)
INSERT INTO "permissions" ("key", "group", "description") VALUES
  ('wine.use', 'Cave à vin', 'Consulter la cave à vin : fiches, accords, bouteilles ouvertes'),
  ('wine.manage', 'Cave à vin', 'Gérer la cave à vin : fiches, prix, réceptions, inventaire, carte des vins, rapport')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r."id", k.key FROM "roles" r
CROSS JOIN (VALUES ('wine.use'), ('wine.manage')) AS k(key)
WHERE r."is_system" AND r."key" IN ('admin', 'manager')
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r."id", 'wine.use' FROM "roles" r
WHERE r."is_system" AND r."key" IN ('server', 'cashier', 'bartender')
ON CONFLICT DO NOTHING;
