-- Fréquentation du site et des connexions (tableau de bord de la console plateforme)
CREATE TABLE "site_events" (
    "id" UUID NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "method" TEXT,
    "path" TEXT,
    "referrer" TEXT,
    "device" TEXT,
    "visitor" TEXT,
    "utm_source" TEXT,
    "utm_campaign" TEXT,
    "organization_id" UUID,
    "user_id" UUID,

    CONSTRAINT "site_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "site_events_kind_at_idx" ON "site_events"("kind", "at");
CREATE INDEX "site_events_at_idx" ON "site_events"("at");
