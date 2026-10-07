-- Comptes employés « PIN seul » (sans e-mail ni mot de passe utilisables)
ALTER TABLE "users" ADD COLUMN "pin_only" BOOLEAN NOT NULL DEFAULT false;

-- Préparations maison : un ingrédient fabriqué à partir d'autres (sauce, marinade…), produit par lot
ALTER TABLE "ingredients" ADD COLUMN "is_preparation" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ingredients" ADD COLUMN "yield_qty" DECIMAL(14,3) NOT NULL DEFAULT 1;
ALTER TYPE "InventoryMovementKind" ADD VALUE 'PRODUCTION';

CREATE TABLE "preparation_lines" (
    "id" UUID NOT NULL,
    "preparation_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "preparation_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "preparation_lines_preparation_id_ingredient_id_key" ON "preparation_lines"("preparation_id", "ingredient_id");
CREATE INDEX "preparation_lines_ingredient_id_idx" ON "preparation_lines"("ingredient_id");

ALTER TABLE "preparation_lines" ADD CONSTRAINT "preparation_lines_preparation_id_fkey" FOREIGN KEY ("preparation_id") REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "preparation_lines" ADD CONSTRAINT "preparation_lines_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Comptabilité : dépenses de l'établissement (charges, factures fournisseurs hors bons de commande)
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "user_id" UUID,
    "supplier_id" UUID,
    "date" TIMESTAMP(3) NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "supplier_name" TEXT,
    "reference" TEXT,
    "amount_ttc" INTEGER NOT NULL,
    "tax_amount" INTEGER NOT NULL DEFAULT 0,
    "method" "PaymentMethod",
    "paid_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "expenses_establishment_id_date_idx" ON "expenses"("establishment_id", "date");

ALTER TABLE "expenses" ADD CONSTRAINT "expenses_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
