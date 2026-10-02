-- Options payantes (programme de base + options à débloquer) et type d'activité de l'établissement
ALTER TABLE "establishments" ADD COLUMN "business_type" TEXT NOT NULL DEFAULT 'restaurant';
ALTER TABLE "organizations" ADD COLUMN "options" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Comptes existants : ils gardent tout ce qu'ils utilisaient (les nouveaux comptes démarrent sur le programme de base)
UPDATE "organizations" SET "options" = ARRAY['stock', 'digital', 'team', 'advanced']::TEXT[];

CREATE TABLE "option_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "option" TEXT NOT NULL,
    "requested_by_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "handled_at" TIMESTAMP(3),

    CONSTRAINT "option_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "option_requests_organization_id_idx" ON "option_requests"("organization_id");
CREATE INDEX "option_requests_status_idx" ON "option_requests"("status");
ALTER TABLE "option_requests" ADD CONSTRAINT "option_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "option_prices" (
    "option" TEXT NOT NULL,
    "monthly" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "option_prices_pkey" PRIMARY KEY ("option")
);
