-- Mode roulotte : numéro ou repère de table saisi à la commande (sans plan de salle)
ALTER TABLE "orders" ADD COLUMN "table_label" TEXT;
