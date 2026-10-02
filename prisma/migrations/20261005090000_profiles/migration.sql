-- Profils de l'équipe : Admin, Gérant, Chef en cuisine, Équipe en salle
-- Noms des rôles système (seulement ceux laissés à leur nom d'origine)
UPDATE "roles" SET "name" = 'Admin (propriétaire)' WHERE "key" = 'owner' AND "is_system" AND "name" = 'Propriétaire';
UPDATE "roles" SET "name" = 'Gérant' WHERE "key" = 'manager' AND "is_system" AND "name" = 'Manager';
UPDATE "roles" SET "name" = 'Chef en cuisine' WHERE "key" = 'kitchen' AND "is_system" AND "name" = 'Cuisine';
UPDATE "roles" SET "name" = 'Équipe en salle' WHERE "key" = 'server' AND "is_system" AND "name" = 'Serveur';

-- Nouveau profil Admin : tous les droits, attribuable (par le propriétaire ou un autre admin)
INSERT INTO "roles" ("id", "organization_id", "key", "name", "is_system")
SELECT gen_random_uuid(), o."id", 'admin', 'Admin', true
FROM "organizations" o
WHERE NOT EXISTS (SELECT 1 FROM "roles" r WHERE r."organization_id" = o."id" AND r."key" = 'admin');

INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r."id", p."key" FROM "roles" r CROSS JOIN "permissions" p
WHERE r."key" = 'admin' AND r."is_system"
ON CONFLICT DO NOTHING;

-- Chef en cuisine : la carte, les recettes et les stocks en plus de l'écran cuisine
INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r."id", k.key FROM "roles" r
CROSS JOIN (VALUES ('catalog.view'), ('catalog.manage'), ('stock.view'), ('stock.manage'), ('orders.view_history')) AS k(key)
WHERE r."key" = 'kitchen' AND r."is_system" AND EXISTS (SELECT 1 FROM "permissions" p WHERE p."key" = k.key)
ON CONFLICT DO NOTHING;
