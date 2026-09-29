#!/usr/bin/env bash
# Restaure une sauvegarde Postgres
# Usage : bash scripts/db-restore.sh /var/backups/manaresto/manaresto-20260612-030000.sql.gz
set -euo pipefail

FILE="${1:-}"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "Usage : bash scripts/db-restore.sh <fichier.sql.gz>"
  echo ""
  echo "Backups disponibles :"
  ls -lh /var/backups/manaresto/ 2>/dev/null || echo "  (aucun)"
  exit 1
fi

echo "⚠️  Cette opération va ÉCRASER la base actuelle."
read -rp "Continuer ? [yes/NO] : " CONFIRM
[ "$CONFIRM" = "yes" ] || { echo "Annulé."; exit 0; }

if [ -f "$(dirname "$0")/../.env" ]; then set -a; . "$(dirname "$0")/../.env"; set +a; fi
PG_USER="${POSTGRES_USER:-manaresto}"; PG_DB="${POSTGRES_DB:-manaresto}"
case "$FILE" in
  *.enc) openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_PASSPHRASE -in "$FILE" | gunzip -c | docker exec -i "${APP_NAME:-manaresto}-db" psql -U "$PG_USER" "$PG_DB" ;;
  *) gunzip -c "$FILE" | docker exec -i "${APP_NAME:-manaresto}-db" psql -U "$PG_USER" "$PG_DB" ;;
esac
echo "✓ Restauration terminée"
