-- Adresses de partage hors format (« …-ta--0e70e », tiret en fin de troncature) : le relais de manaresto.com ne les
-- reconnaît pas. Tirets doublés ramenés à un, tirets de bord retirés ; si l'adresse corrigée est déjà prise (ou en double
-- entre deux corrections), suffixe tiré de l'identifiant de l'établissement.
WITH bad AS (
  SELECT id, created_at, trim(both '-' from regexp_replace(share_slug, '-{2,}', '-', 'g')) AS s
  FROM "establishments"
  WHERE share_slug IS NOT NULL AND share_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
), ranked AS (
  SELECT id, s, row_number() OVER (PARTITION BY s ORDER BY created_at, id) AS n FROM bad
)
UPDATE "establishments" e
SET "share_slug" = CASE
  WHEN r.n = 1 AND length(r.s) >= 3 AND NOT EXISTS (SELECT 1 FROM "establishments" o WHERE o.share_slug = r.s AND o.id <> e.id) THEN r.s
  ELSE rtrim(left(r.s, 34), '-') || '-' || left(replace(e.id::text, '-', ''), 5)
END
FROM ranked r WHERE r.id = e.id;
