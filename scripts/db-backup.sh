#!/usr/bin/env bash
# Sauvegarde quotidienne de la base Postgres.
# À ajouter au crontab : 0 3 * * * /opt/__APP_NAME__/scripts/db-backup.sh
set -euo pipefail

cd "$(dirname "$0")/.."

BACKUP_DIR="${BACKUP_DIR:-/var/backups/__APP_NAME__}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
TIMESTAMP=$(date -u +%Y%m%d-%H%M%S)
FILE="$BACKUP_DIR/__APP_NAME__-$TIMESTAMP.sql.gz"

mkdir -p "$BACKUP_DIR"

# Dump via le container
docker exec __APP_NAME__-db pg_dump -U __APP_NAME__ __APP_NAME__ | gzip > "$FILE"

echo "✓ Backup → $FILE ($(du -h "$FILE" | cut -f1))"

# Nettoyer les anciens backups
find "$BACKUP_DIR" -name "__APP_NAME__-*.sql.gz" -mtime +$RETENTION_DAYS -delete
echo "✓ Nettoyage des backups > $RETENTION_DAYS jours"
