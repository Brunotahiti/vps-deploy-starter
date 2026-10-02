-- Réservations : durée, origine (téléphone, sur place, en ligne), repères et personne qui a pris l'appel
ALTER TABLE "reservations" ADD COLUMN "duration_minutes" INTEGER NOT NULL DEFAULT 90;
ALTER TABLE "reservations" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'PHONE';
ALTER TABLE "reservations" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "reservations" ADD COLUMN "created_by_name" TEXT;

-- Les réservations existantes prises sans membre de l'équipe (aucun « reservation.create » au journal) venaient du site
UPDATE "reservations" r SET "source" = 'ONLINE'
WHERE NOT EXISTS (SELECT 1 FROM "audit_logs" a WHERE a."action" = 'reservation.create' AND a."entity_id"::text = r."id"::text);
