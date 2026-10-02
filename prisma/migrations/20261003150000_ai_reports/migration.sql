-- Assistant IA : analyses gardées (qualité, semaine à venir)
CREATE TABLE "ai_reports" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "establishment_id" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "period_from" TIMESTAMP(3) NOT NULL,
  "period_to" TIMESTAMP(3) NOT NULL,
  "data" JSONB NOT NULL,
  "model" TEXT NOT NULL,
  "created_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_reports_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ai_reports_establishment_id_kind_created_at_idx" ON "ai_reports"("establishment_id", "kind", "created_at");

-- Le restaurant exemple montre l'Assistant IA
UPDATE "organizations" SET "options" = "options" || ARRAY['ai']::TEXT[] WHERE "slug" = 'demo-mana-beach' AND NOT ('ai' = ANY("options"));
