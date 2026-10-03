-- Adresse de partage du site du restaurant (manaresto.com/<share_slug>), unique sur toute la plateforme

-- AlterTable
ALTER TABLE "establishments" ADD COLUMN     "share_slug" TEXT;

-- Adresses des restaurants existants : leur identifiant actuel (déjà en minuscules et tirets), 40 caractères au plus ;
-- un mot réservé ou trop court reçoit « -resto », un doublon un suffixe tiré de son identifiant
WITH base AS (
  SELECT id, created_at,
    CASE WHEN length(trim(both '-' from left(slug, 40))) < 3 OR trim(both '-' from left(slug, 40)) IN ('admin', 'aide', 'api', 'app', 'assets', 'blog', 'commande', 'commander', 'conditions', 'confidentialite', 'contact', 'demo', 'devis', 'desabonnement', 'ecran', 'favicon', 'icons', 'index', 'inscription', 'invitation', 'kds', 'kiosk', 'login', 'manaresto', 'mentions-legales', 'm', 'nginx', 'onboarding', 'platform', 'pos', 'presse', 'prix', 'r', 'readme', 'reserver', 'robots', 'salle', 'signup', 'site', 'sitemap', 'static', 'suivi', 'support', 'tarifs', 'test', 'www', '404', '500')
      THEN left(trim(both '-' from left(slug, 34)), 34) || '-resto'
      ELSE trim(both '-' from left(slug, 40)) END AS s
  FROM "establishments"
), ranked AS (
  SELECT id, s, row_number() OVER (PARTITION BY s ORDER BY created_at, id) AS n FROM base
)
UPDATE "establishments" e
SET "share_slug" = CASE WHEN r.n = 1 THEN r.s ELSE left(r.s, 34) || '-' || left(replace(e.id::text, '-', ''), 5) END
FROM ranked r WHERE r.id = e.id;

-- CreateIndex
CREATE UNIQUE INDEX "establishments_share_slug_key" ON "establishments"("share_slug");
