#!/usr/bin/env bash
# Sauvegarde quotidienne de la base Postgres.
# À ajouter au crontab : 0 3 * * * /opt/manaresto/scripts/db-backup.sh
set -euo pipefail

cd "$(dirname "$0")/.."

BACKUP_DIR="${BACKUP_DIR:-/var/backups/manaresto}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
TIMESTAMP=$(date -u +%Y%m%d-%H%M%S)
FILE="$BACKUP_DIR/manaresto-$TIMESTAMP.sql.gz"

mkdir -p "$BACKUP_DIR"

# Dump via le container (utilisateur/base lus depuis .env si présent)
if [ -f .env ]; then set -a; . ./.env; set +a; fi
PG_USER="${POSTGRES_USER:-manaresto}"; PG_DB="${POSTGRES_DB:-manaresto}"
if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  # Sauvegarde chiffrée (AES-256, mot de passe dans BACKUP_PASSPHRASE)
  FILE="$FILE.enc"
  docker exec "${APP_NAME:-manaresto}-db" pg_dump -U "$PG_USER" "$PG_DB" | gzip | openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:BACKUP_PASSPHRASE -out "$FILE"
else
  docker exec "${APP_NAME:-manaresto}-db" pg_dump -U "$PG_USER" "$PG_DB" | gzip > "$FILE"
fi

echo "✓ Backup → $FILE ($(du -h "$FILE" | cut -f1))"

# Nettoyer les anciens backups
find "$BACKUP_DIR" \( -name "manaresto-*.sql.gz" -o -name "manaresto-*.sql.gz.enc" \) -mtime +$RETENTION_DAYS -delete
echo "✓ Nettoyage des backups > $RETENTION_DAYS jours"
