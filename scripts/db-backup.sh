#!/usr/bin/env bash
# Sauvegarde quotidienne de la base Postgres.
# À ajouter au crontab : 0 3 * * * /opt/manaresto/scripts/db-backup.sh
set -euo pipefail
# Sauvegardes lisibles par l'administrateur seul (elles contiennent toute la base)
umask 077

cd "$(dirname "$0")/.."

BACKUP_DIR="${BACKUP_DIR:-/var/backups/manaresto}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
TIMESTAMP=$(date -u +%Y%m%d-%H%M%S)
FILE="$BACKUP_DIR/manaresto-$TIMESTAMP.sql.gz"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
# Un dump interrompu ne doit jamais laisser un fichier tronqué qui ressemble à une sauvegarde valide
trap 'rm -f "$FILE"' ERR

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

# Vérification : archive lisible et non vide
if [ -z "${BACKUP_PASSPHRASE:-}" ]; then gzip -t "$FILE"; fi
[ "$(wc -c < "$FILE")" -gt 1000 ] || { echo "✗ Sauvegarde anormalement petite : $FILE"; rm -f "$FILE"; exit 1; }
echo "✓ Backup → $FILE ($(du -h "$FILE" | cut -f1))"
trap - ERR # la sauvegarde locale est valide : plus rien ne doit la supprimer

# Copie hors du serveur (BACKUP_REMOTE, ex. « b2:manaresto-sauvegardes ») : si le serveur est perdu, les sauvegardes ne le sont pas.
# rclone tourne dans Docker (rien à installer) ; configuration une seule fois avec scripts/backup-remote-setup.sh.
# Les sauvegardes contiennent les données des clients des restaurants : elles ne quittent le serveur que chiffrées.
if [ -n "${BACKUP_REMOTE:-}" ] && [ -z "${SKIP_REMOTE:-}" ]; then
  if [ -z "${BACKUP_PASSPHRASE:-}" ]; then
    echo "✗ Copie hors serveur refusée : définissez BACKUP_PASSPHRASE dans .env pour chiffrer les sauvegardes"; exit 1
  fi
  RCLONE=(docker run --rm -v "$BACKUP_DIR:/data:ro" -v "${RCLONE_CONFIG_DIR:-/root/.config/rclone}:/config/rclone" rclone/rclone:1)
  "${RCLONE[@]}" copyto "/data/$(basename "$FILE")" "$BACKUP_REMOTE/$(basename "$FILE")" --retries 5 \
    || { echo "✗ Copie hors serveur échouée (la sauvegarde locale est conservée : $FILE)"; exit 1; }
  echo "✓ Copie hors serveur → $BACKUP_REMOTE"
  # Côté distant, conservation plus longue qu'en local
  "${RCLONE[@]}" delete "$BACKUP_REMOTE" --min-age "${REMOTE_RETENTION_DAYS:-90}d" --include "manaresto-*" >/dev/null 2>&1 || true
fi

# Nettoyer les anciens backups
find "$BACKUP_DIR" \( -name "manaresto-*.sql.gz" -o -name "manaresto-*.sql.gz.enc" \) -mtime +$RETENTION_DAYS -delete
echo "✓ Nettoyage des backups > $RETENTION_DAYS jours"
