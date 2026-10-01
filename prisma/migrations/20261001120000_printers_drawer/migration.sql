-- Imprimantes connectées et tiroir-caisse : options du tiroir, caisse associée, jeton d'interrogation, file d'impression
CREATE TYPE "PrintJobStatus" AS ENUM ('PENDING', 'SENT', 'DONE', 'FAILED');

ALTER TABLE "printers" ADD COLUMN "has_drawer" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "printers" ADD COLUMN "drawer_pin" INTEGER NOT NULL DEFAULT 2;
ALTER TABLE "printers" ADD COLUMN "terminal_id" UUID;
ALTER TABLE "printers" ADD COLUMN "cloud_token_hash" TEXT;
ALTER TABLE "printers" ADD COLUMN "last_seen_at" TIMESTAMP(3);
ALTER TABLE "printers" ADD COLUMN "last_status" TEXT;
CREATE UNIQUE INDEX "printers_cloud_token_hash_key" ON "printers"("cloud_token_hash");
ALTER TABLE "printers" ADD CONSTRAINT "printers_terminal_id_fkey" FOREIGN KEY ("terminal_id") REFERENCES "terminals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "print_jobs" (
  "id" UUID NOT NULL,
  "establishment_id" UUID NOT NULL,
  "printer_id" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "document" JSONB NOT NULL,
  "status" "PrintJobStatus" NOT NULL DEFAULT 'PENDING',
  "error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sent_at" TIMESTAMP(3),
  "done_at" TIMESTAMP(3),
  CONSTRAINT "print_jobs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "print_jobs_printer_id_status_created_at_idx" ON "print_jobs"("printer_id", "status", "created_at");
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_printer_id_fkey" FOREIGN KEY ("printer_id") REFERENCES "printers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
