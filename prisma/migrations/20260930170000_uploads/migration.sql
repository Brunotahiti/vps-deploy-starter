-- Photos envoyées depuis l'application (stockées en base)
CREATE TABLE "uploads" (
  "id" UUID NOT NULL,
  "establishment_id" UUID NOT NULL,
  "mime" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "width" INTEGER,
  "height" INTEGER,
  "data" BYTEA NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "uploads_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "uploads_establishment_id_idx" ON "uploads"("establishment_id");
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
