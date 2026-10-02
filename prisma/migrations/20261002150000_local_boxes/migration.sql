-- Boîtier local (relais de secours pendant les coupures d'internet)
CREATE TABLE "local_boxes" (
  "id" UUID NOT NULL,
  "establishment_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "created_by_id" UUID,
  "last_seen_at" TIMESTAMP(3),
  "last_ip" TEXT,
  "lan_ip" TEXT,
  "version" TEXT,
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "local_boxes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "local_boxes_token_hash_key" ON "local_boxes"("token_hash");
CREATE INDEX "local_boxes_establishment_id_idx" ON "local_boxes"("establishment_id");
ALTER TABLE "local_boxes" ADD CONSTRAINT "local_boxes_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
