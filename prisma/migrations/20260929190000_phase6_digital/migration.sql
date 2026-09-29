-- Phase 6 — Digital : suivi public des commandes, métadonnées de canal, appel serveur par QR
ALTER TABLE "orders" ADD COLUMN "public_token" TEXT,
                     ADD COLUMN "channel_meta" JSONB,
                     ADD COLUMN "accepted_at" TIMESTAMP(3);
CREATE UNIQUE INDEX "orders_public_token_key" ON "orders"("public_token");
ALTER TABLE "tables" ADD COLUMN "call_requested_at" TIMESTAMP(3);
