-- Sessions ouvertes par un boîtier de secours : limitées à la caisse, supprimées avec le boîtier
ALTER TABLE "sessions" ADD COLUMN "scope" TEXT;
ALTER TABLE "sessions" ADD COLUMN "box_id" UUID;

ALTER TABLE "sessions" ADD CONSTRAINT "sessions_box_id_fkey" FOREIGN KEY ("box_id") REFERENCES "local_boxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
