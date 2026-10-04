-- Demande de démonstration simplifiée : un seul moyen de contact suffit (téléphone ou e-mail), commune et type facultatifs
ALTER TABLE "demo_requests" ALTER COLUMN "phone" DROP NOT NULL;
ALTER TABLE "demo_requests" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "demo_requests" ALTER COLUMN "commune" DROP NOT NULL;
ALTER TABLE "demo_requests" ALTER COLUMN "kind" DROP NOT NULL;
