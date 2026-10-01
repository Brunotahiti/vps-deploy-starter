-- Limites de tentatives et de débit stockées en base (conservées aux redémarrages et aux déploiements)
CREATE TABLE "rate_hits" (
  "id" BIGSERIAL NOT NULL,
  "key" TEXT NOT NULL,
  "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rate_hits_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "rate_hits_key_at_idx" ON "rate_hits"("key", "at");
