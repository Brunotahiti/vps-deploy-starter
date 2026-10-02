-- Traiteur & événements (option payante « catering ») : devis, acomptes, factures, planning

-- CreateTable
CREATE TABLE "catering_events" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'OTHER',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "guests" INTEGER NOT NULL,
    "location" TEXT,
    "privatize" BOOLEAN NOT NULL DEFAULT false,
    "client_name" TEXT NOT NULL,
    "client_company" TEXT,
    "client_tahiti_number" TEXT,
    "client_email" TEXT,
    "client_phone" TEXT,
    "client_address" TEXT,
    "lines" JSONB NOT NULL DEFAULT '[]',
    "total_ttc" INTEGER NOT NULL DEFAULT 0,
    "total_tax" INTEGER NOT NULL DEFAULT 0,
    "deposit_amount" INTEGER NOT NULL DEFAULT 0,
    "quote_notes" TEXT,
    "kitchen_notes" TEXT,
    "internal_notes" TEXT,
    "quote_number" TEXT,
    "quote_year" INTEGER,
    "quote_seq" INTEGER,
    "quote_sent_at" TIMESTAMP(3),
    "valid_until" TIMESTAMP(3),
    "public_token" TEXT NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "accepted_by" TEXT,
    "invoice_number" TEXT,
    "invoice_year" INTEGER,
    "invoice_seq" INTEGER,
    "invoiced_at" TIMESTAMP(3),
    "invoice_due_at" TIMESTAMP(3),
    "invoice" JSONB,
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catering_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catering_payments" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID,
    "cash_session_id" UUID,

    CONSTRAINT "catering_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "catering_events_public_token_key" ON "catering_events"("public_token");

-- CreateIndex
CREATE INDEX "catering_events_establishment_id_starts_at_idx" ON "catering_events"("establishment_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "catering_events_establishment_id_quote_number_key" ON "catering_events"("establishment_id", "quote_number");

-- CreateIndex
CREATE UNIQUE INDEX "catering_events_establishment_id_quote_year_quote_seq_key" ON "catering_events"("establishment_id", "quote_year", "quote_seq");

-- CreateIndex
CREATE UNIQUE INDEX "catering_events_establishment_id_invoice_number_key" ON "catering_events"("establishment_id", "invoice_number");

-- CreateIndex
CREATE UNIQUE INDEX "catering_events_establishment_id_invoice_year_invoice_seq_key" ON "catering_events"("establishment_id", "invoice_year", "invoice_seq");

-- CreateIndex
CREATE INDEX "catering_payments_event_id_idx" ON "catering_payments"("event_id");

-- CreateIndex
CREATE INDEX "catering_payments_establishment_id_received_at_idx" ON "catering_payments"("establishment_id", "received_at");

-- AddForeignKey
ALTER TABLE "catering_events" ADD CONSTRAINT "catering_events_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catering_payments" ADD CONSTRAINT "catering_payments_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catering_payments" ADD CONSTRAINT "catering_payments_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "catering_events"("id") ON DELETE NO ACTION ON UPDATE CASCADE;


-- Droits : consulter le planning et la fiche cuisine, gérer les devis, acomptes et factures
INSERT INTO "permissions" ("key", "group", "description") VALUES
  ('catering.view', 'Traiteur', 'Consulter le planning des événements et la fiche cuisine'),
  ('catering.manage', 'Traiteur', 'Gérer les événements : devis, acomptes, factures')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r."id", k.key FROM "roles" r
CROSS JOIN (VALUES ('catering.view'), ('catering.manage')) AS k(key)
WHERE r."is_system" AND r."key" IN ('admin', 'manager')
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r."id", 'catering.view' FROM "roles" r
WHERE r."is_system" AND r."key" IN ('kitchen', 'server', 'cashier')
ON CONFLICT DO NOTHING;
