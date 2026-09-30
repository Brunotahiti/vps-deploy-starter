-- Phase 9 : suivi de service (parcours par table et rappels)
CREATE TYPE "ServiceStepStatus" AS ENUM ('PENDING', 'DONE', 'SKIPPED', 'NOT_NEEDED');
CREATE TYPE "ServiceReminderKind" AS ENUM ('BRING', 'TAKE_ORDER', 'CHECK', 'DESSERT', 'BILL', 'CUSTOM');
CREATE TYPE "ServiceReminderStatus" AS ENUM ('OPEN', 'DONE', 'CANCELLED');

CREATE TABLE "table_service_steps" (
  "id" UUID NOT NULL,
  "establishment_id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "status" "ServiceStepStatus" NOT NULL DEFAULT 'PENDING',
  "reason" TEXT,
  "done_at" TIMESTAMP(3),
  "done_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "table_service_steps_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "table_service_steps_order_id_key_key" ON "table_service_steps"("order_id", "key");
CREATE INDEX "table_service_steps_establishment_id_idx" ON "table_service_steps"("establishment_id");
ALTER TABLE "table_service_steps" ADD CONSTRAINT "table_service_steps_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "table_service_steps" ADD CONSTRAINT "table_service_steps_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "service_reminders" (
  "id" UUID NOT NULL,
  "establishment_id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "table_id" UUID,
  "kind" "ServiceReminderKind" NOT NULL,
  "label" TEXT NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 5,
  "due_at" TIMESTAMP(3) NOT NULL,
  "status" "ServiceReminderStatus" NOT NULL DEFAULT 'OPEN',
  "assigned_to_id" UUID,
  "ticket_id" UUID,
  "meta" JSONB,
  "snooze_count" INTEGER NOT NULL DEFAULT 0,
  "snoozed_by_id" UUID,
  "done_at" TIMESTAMP(3),
  "done_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "service_reminders_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "service_reminders_establishment_id_status_due_at_idx" ON "service_reminders"("establishment_id", "status", "due_at");
CREATE INDEX "service_reminders_order_id_idx" ON "service_reminders"("order_id");
ALTER TABLE "service_reminders" ADD CONSTRAINT "service_reminders_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_reminders" ADD CONSTRAINT "service_reminders_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
