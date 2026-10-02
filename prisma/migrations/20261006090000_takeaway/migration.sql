-- Vente à emporter : heure de retrait, téléphone du client, commande prête puis remise
ALTER TABLE "orders" ADD COLUMN "customer_phone" TEXT;
ALTER TABLE "orders" ADD COLUMN "pickup_at" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN "ready_at" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN "picked_up_at" TIMESTAMP(3);
CREATE INDEX "orders_establishment_id_type_opened_at_idx" ON "orders"("establishment_id", "type", "opened_at");
