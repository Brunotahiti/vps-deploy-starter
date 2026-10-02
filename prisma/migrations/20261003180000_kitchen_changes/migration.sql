-- Modifications et annulations envoyées en cuisine (demandée → vue → appliquée)
CREATE TABLE "kitchen_changes" (
  "id" UUID NOT NULL,
  "establishment_id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "order_item_id" UUID,
  "ticket_id" UUID,
  "station_id" UUID,
  "kind" TEXT NOT NULL,
  "urgent" BOOLEAN NOT NULL DEFAULT false,
  "stage" TEXT NOT NULL,
  "item_name" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "table_name" TEXT,
  "order_number" TEXT NOT NULL,
  "removed" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "added" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "note" TEXT,
  "reason" TEXT,
  "status" TEXT NOT NULL DEFAULT 'REQUESTED',
  "requested_by_id" UUID,
  "requested_by_name" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "seen_at" TIMESTAMP(3),
  "applied_at" TIMESTAMP(3),
  CONSTRAINT "kitchen_changes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "kitchen_changes_establishment_id_status_idx" ON "kitchen_changes"("establishment_id", "status");
CREATE INDEX "kitchen_changes_order_id_idx" ON "kitchen_changes"("order_id");
ALTER TABLE "kitchen_changes" ADD CONSTRAINT "kitchen_changes_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
