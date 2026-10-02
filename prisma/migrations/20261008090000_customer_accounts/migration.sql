-- Comptes clients & factures pro (option payante « accounts ») : paiements « Sur compte », factures, règlements

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'ACCOUNT';

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "customer_account_id" UUID,
ADD COLUMN     "invoice_id" UUID;

-- CreateTable
CREATE TABLE "customer_accounts" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "tahiti_number" TEXT,
    "contact_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "credit_limit" INTEGER,
    "payment_terms_days" INTEGER NOT NULL DEFAULT 30,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_invoices" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_at" TIMESTAMP(3) NOT NULL,
    "total_ttc" INTEGER NOT NULL,
    "total_tax" INTEGER NOT NULL,
    "lines" JSONB NOT NULL,
    "taxes" JSONB NOT NULL,
    "buyer" JSONB NOT NULL,
    "reminded_at" TIMESTAMP(3),
    "reminder_count" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID,

    CONSTRAINT "account_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_settlements" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID,
    "cash_session_id" UUID,

    CONSTRAINT "account_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_accounts_establishment_id_idx" ON "customer_accounts"("establishment_id");

-- CreateIndex
CREATE INDEX "account_invoices_account_id_idx" ON "account_invoices"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "account_invoices_establishment_id_number_key" ON "account_invoices"("establishment_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "account_invoices_establishment_id_year_seq_key" ON "account_invoices"("establishment_id", "year", "seq");

-- CreateIndex
CREATE INDEX "account_settlements_account_id_received_at_idx" ON "account_settlements"("account_id", "received_at");

-- CreateIndex
CREATE INDEX "account_settlements_establishment_id_received_at_idx" ON "account_settlements"("establishment_id", "received_at");

-- CreateIndex
CREATE INDEX "payments_customer_account_id_invoice_id_idx" ON "payments"("customer_account_id", "invoice_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_account_id_fkey" FOREIGN KEY ("customer_account_id") REFERENCES "customer_accounts"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "account_invoices"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_accounts" ADD CONSTRAINT "customer_accounts_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_invoices" ADD CONSTRAINT "account_invoices_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_invoices" ADD CONSTRAINT "account_invoices_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "customer_accounts"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_settlements" ADD CONSTRAINT "account_settlements_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_settlements" ADD CONSTRAINT "account_settlements_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "customer_accounts"("id") ON DELETE NO ACTION ON UPDATE CASCADE;


-- Droits : mettre sur compte (caisse) et gérer les comptes (factures, règlements, relances)
INSERT INTO "permissions" ("key", "group", "description") VALUES
  ('accounts.charge', 'Comptes clients', 'Mettre une addition sur le compte d''un client pro'),
  ('accounts.manage', 'Comptes clients', 'Gérer les comptes clients : factures, règlements, relances')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r."id", k.key FROM "roles" r
CROSS JOIN (VALUES ('accounts.charge'), ('accounts.manage')) AS k(key)
WHERE r."is_system" AND r."key" IN ('admin', 'manager')
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r."id", 'accounts.charge' FROM "roles" r
WHERE r."is_system" AND r."key" IN ('cashier', 'server')
ON CONFLICT DO NOTHING;
