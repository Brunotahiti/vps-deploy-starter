-- Phase 8 : index pour les rapports (filtrés par date de clôture)
CREATE INDEX IF NOT EXISTS "orders_establishment_id_closed_at_idx" ON "orders"("establishment_id", "closed_at");
