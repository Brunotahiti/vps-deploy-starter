-- Offre commerciale : essai gratuit de 15 jours puis abonnement
CREATE TYPE "Plan" AS ENUM ('TRIAL', 'ACTIVE', 'SUSPENDED');
ALTER TABLE "organizations"
  ADD COLUMN "plan" "Plan" NOT NULL DEFAULT 'TRIAL',
  ADD COLUMN "trial_ends_at" TIMESTAMP(3),
  ADD COLUMN "plan_started_at" TIMESTAMP(3),
  ADD COLUMN "billing_email" TEXT;
-- Entreprises existantes : essai de 15 jours à compter d'aujourd'hui
UPDATE "organizations" SET "trial_ends_at" = CURRENT_TIMESTAMP + INTERVAL '15 days' WHERE "trial_ends_at" IS NULL;
