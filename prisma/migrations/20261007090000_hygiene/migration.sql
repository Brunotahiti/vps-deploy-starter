-- Hygiène & HACCP (option payante « hygiene ») : températures, plan de nettoyage, traçabilité

-- CreateTable
CREATE TABLE "hygiene_equipment" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'FRIDGE',
    "min_temp" INTEGER NOT NULL,
    "max_temp" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hygiene_equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "temperature_readings" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "equipment_id" UUID NOT NULL,
    "value" INTEGER NOT NULL,
    "min_temp" INTEGER NOT NULL,
    "max_temp" INTEGER NOT NULL,
    "compliant" BOOLEAN NOT NULL,
    "corrective_action" TEXT,
    "user_id" UUID,
    "taken_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "temperature_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cleaning_tasks" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "area" TEXT,
    "frequency" TEXT NOT NULL DEFAULT 'DAILY',
    "instructions" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cleaning_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cleaning_logs" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "user_id" UUID,
    "note" TEXT,
    "done_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cleaning_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trace_records" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "supplier_name" TEXT,
    "lot_number" TEXT,
    "quantity" TEXT,
    "temperature" INTEGER,
    "compliant" BOOLEAN NOT NULL DEFAULT true,
    "issue" TEXT,
    "made_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "use_by" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "closed_reason" TEXT,
    "user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trace_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hygiene_equipment_establishment_id_idx" ON "hygiene_equipment"("establishment_id");

-- CreateIndex
CREATE INDEX "temperature_readings_establishment_id_taken_at_idx" ON "temperature_readings"("establishment_id", "taken_at");

-- CreateIndex
CREATE INDEX "temperature_readings_equipment_id_taken_at_idx" ON "temperature_readings"("equipment_id", "taken_at");

-- CreateIndex
CREATE INDEX "cleaning_tasks_establishment_id_idx" ON "cleaning_tasks"("establishment_id");

-- CreateIndex
CREATE INDEX "cleaning_logs_establishment_id_done_at_idx" ON "cleaning_logs"("establishment_id", "done_at");

-- CreateIndex
CREATE INDEX "cleaning_logs_task_id_done_at_idx" ON "cleaning_logs"("task_id", "done_at");

-- CreateIndex
CREATE INDEX "trace_records_establishment_id_made_at_idx" ON "trace_records"("establishment_id", "made_at");

-- CreateIndex
CREATE INDEX "trace_records_establishment_id_use_by_idx" ON "trace_records"("establishment_id", "use_by");

-- AddForeignKey
ALTER TABLE "hygiene_equipment" ADD CONSTRAINT "hygiene_equipment_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temperature_readings" ADD CONSTRAINT "temperature_readings_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temperature_readings" ADD CONSTRAINT "temperature_readings_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "hygiene_equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temperature_readings" ADD CONSTRAINT "temperature_readings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cleaning_tasks" ADD CONSTRAINT "cleaning_tasks_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cleaning_logs" ADD CONSTRAINT "cleaning_logs_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cleaning_logs" ADD CONSTRAINT "cleaning_logs_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "cleaning_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cleaning_logs" ADD CONSTRAINT "cleaning_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trace_records" ADD CONSTRAINT "trace_records_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trace_records" ADD CONSTRAINT "trace_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Droits : enregistrer (relevés, nettoyages, traçabilité) et gérer (équipements, plan, registre)
INSERT INTO "permissions" ("key", "group", "description") VALUES
  ('hygiene.record', 'Hygiène', 'Enregistrer relevés de température, nettoyages et traçabilité'),
  ('hygiene.manage', 'Hygiène', 'Gérer le plan d''hygiène (équipements, nettoyage) et consulter le registre')
ON CONFLICT ("key") DO NOTHING;

-- Admin, Gérant et Chef en cuisine : les deux ; Équipe en salle : enregistrer (nettoyage de la salle)
INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r."id", k.key FROM "roles" r
CROSS JOIN (VALUES ('hygiene.record'), ('hygiene.manage')) AS k(key)
WHERE r."is_system" AND r."key" IN ('admin', 'manager', 'kitchen')
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r."id", 'hygiene.record' FROM "roles" r
WHERE r."is_system" AND r."key" = 'server'
ON CONFLICT DO NOTHING;
