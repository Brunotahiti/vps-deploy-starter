-- Nouvelles options : Statistiques & rapports, Continuité de service (hors ligne + boîtier).
-- Les comptes qui avaient déjà tout (clients d'avant le programme de base, ou toutes options activées) les gardent.
UPDATE "organizations"
SET "options" = "options" || ARRAY['stats', 'continuity']::TEXT[]
WHERE "options" @> ARRAY['stock', 'digital', 'team', 'advanced']::TEXT[]
  AND NOT ("options" @> ARRAY['stats', 'continuity']::TEXT[]);
-- Le boîtier de secours passe d'« Avancé » à « Continuité de service » : qui l'utilise déjà le garde
UPDATE "organizations" o
SET "options" = o."options" || ARRAY['continuity']::TEXT[]
WHERE NOT ('continuity' = ANY(o."options"))
  AND EXISTS (SELECT 1 FROM "local_boxes" b JOIN "establishments" e ON e."id" = b."establishment_id" WHERE e."organization_id" = o."id" AND b."revoked_at" IS NULL);
