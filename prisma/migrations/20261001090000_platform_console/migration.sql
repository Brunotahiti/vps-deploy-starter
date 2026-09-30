-- Console plateforme : blocage, fin de période, prise en main, activité, e-mails
ALTER TABLE "organizations" ADD COLUMN "period_ends_at" TIMESTAMP(3);
ALTER TABLE "organizations" ADD COLUMN "blocked_at" TIMESTAMP(3);
ALTER TABLE "organizations" ADD COLUMN "blocked_reason" TEXT;
ALTER TABLE "sessions" ADD COLUMN "impersonator_id" UUID;

CREATE TABLE "activity_days" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "day" DATE NOT NULL,
  "minutes" INTEGER NOT NULL DEFAULT 0,
  "last_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "activity_days_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "activity_days_user_id_day_key" ON "activity_days"("user_id", "day");
CREATE INDEX "activity_days_organization_id_day_idx" ON "activity_days"("organization_id", "day");
ALTER TABLE "activity_days" ADD CONSTRAINT "activity_days_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "activity_days" ADD CONSTRAINT "activity_days_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "platform_emails" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "to" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "error" TEXT,
  "sent_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_emails_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "platform_emails_organization_id_created_at_idx" ON "platform_emails"("organization_id", "created_at");
ALTER TABLE "platform_emails" ADD CONSTRAINT "platform_emails_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
