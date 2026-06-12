#!/usr/bin/env bash
# Restaure une sauvegarde Postgres
# Usage : bash scripts/db-restore.sh /var/backups/__APP_NAME__/__APP_NAME__-20260612-030000.sql.gz
set -euo pipefail

FILE="${1:-}"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "Usage : bash scripts/db-restore.sh <fichier.sql.gz>"
  echo ""
  echo "Backups disponibles :"
  ls -lh /var/backups/__APP_NAME__/ 2>/dev/null || echo "  (aucun)"
  exit 1
fi

echo "⚠️  Cette opération va ÉCRASER la base actuelle."
read -rp "Continuer ? [yes/NO] : " CONFIRM
[ "$CONFIRM" = "yes" ] || { echo "Annulé."; exit 0; }

gunzip -c "$FILE" | docker exec -i __APP_NAME__-db psql -U __APP_NAME__ __APP_NAME__
echo "✓ Restauration terminée"
