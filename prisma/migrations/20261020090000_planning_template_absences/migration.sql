-- CreateEnum
CREATE TYPE "AbsenceKind" AS ENUM ('LEAVE', 'SICK', 'OTHER');

-- AlterTable
ALTER TABLE "shifts" ADD COLUMN     "is_edited" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "replaces_employee_id" UUID,
ADD COLUMN     "template_id" UUID;

-- CreateTable
CREATE TABLE "shift_templates" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "notes" TEXT,
    "valid_from" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shift_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planning_weeks" (
    "establishment_id" UUID NOT NULL,
    "monday" DATE NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "planning_weeks_pkey" PRIMARY KEY ("establishment_id","monday")
);

-- CreateTable
CREATE TABLE "staff_absences" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "kind" "AbsenceKind" NOT NULL DEFAULT 'LEAVE',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_absences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shift_templates_establishment_id_idx" ON "shift_templates"("establishment_id");

-- CreateIndex
CREATE INDEX "staff_absences_establishment_id_starts_on_idx" ON "staff_absences"("establishment_id", "starts_on");

-- CreateIndex
CREATE INDEX "shifts_template_id_idx" ON "shifts"("template_id");

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "shift_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_replaces_employee_id_fkey" FOREIGN KEY ("replaces_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planning_weeks" ADD CONSTRAINT "planning_weeks_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_absences" ADD CONSTRAINT "staff_absences_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_absences" ADD CONSTRAINT "staff_absences_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

