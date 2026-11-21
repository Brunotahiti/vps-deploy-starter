-- Dépenses de la comptabilité : saisie, modification et suppression réservées au gérant (et à l'administrateur).
-- Les profils qui consultent les rapports (Responsable caisse, Comptable) gardent la consultation.
INSERT INTO "permissions" ("key", "group", "description") VALUES
  ('accounting.manage', 'Rapports', 'Saisir, modifier et supprimer les dépenses de la comptabilité')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r."id", 'accounting.manage' FROM "roles" r
WHERE r."is_system" AND r."key" IN ('admin', 'manager')
ON CONFLICT DO NOTHING;
