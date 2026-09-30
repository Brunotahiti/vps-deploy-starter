-- Demandes de démonstration (site vitrine)
CREATE TABLE "demo_requests" (
  "id" UUID NOT NULL,
  "restaurant_name" TEXT NOT NULL,
  "contact_name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "commune" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "message" TEXT,
  "consent" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'NEW',
  "ip" TEXT,
  "user_agent" TEXT,
  "email_sent" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "demo_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "demo_requests_created_at_idx" ON "demo_requests"("created_at");
