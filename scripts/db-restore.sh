#!/usr/bin/env bash
# Restaure une sauvegarde Postgres de façon sûre.
# Usage : bash scripts/db-restore.sh /var/backups/manaresto/manaresto-20260612-030000.sql.gz[.enc]
#  1. vérifie que l'archive est lisible (et déchiffrable) AVANT de toucher à la base ;
#  2. fait une sauvegarde de sécurité de la base actuelle ;
#  3. arrête l'application pendant l'opération (aucune écriture concurrente) ;
#  4. vide la base puis restaure en une seule transaction, en s'arrêtant à la première erreur :
#     en cas d'échec, la base reste exactement dans son état d'avant ;
#  5. relance l'application.
set -euo pipefail

cd "$(dirname "$0")/.."
FILE="${1:-}"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "Usage : bash scripts/db-restore.sh <fichier.sql.gz | fichier.sql.gz.enc>"
  echo ""
  echo "Sauvegardes disponibles :"
  ls -lht /var/backups/manaresto/ 2>/dev/null | head -20 || echo "  (aucune)"
  exit 1
fi
if [ -f .env ]; then set -a; . ./.env; set +a; fi
PG_USER="${POSTGRES_USER:-manaresto}"; PG_DB="${POSTGRES_DB:-manaresto}"
DB="${APP_NAME:-manaresto}-db"

read_dump() {
  case "$FILE" in
    *.enc) [ -n "${BACKUP_PASSPHRASE:-}" ] || { echo "✗ BACKUP_PASSPHRASE requis pour une sauvegarde chiffrée" >&2; exit 1; }
           openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_PASSPHRASE -in "$FILE" | gunzip -c ;;
    *) gunzip -c "$FILE" ;;
  esac
}

echo "→ Vérification de l'archive…"
LINES=$(read_dump | wc -l) || { echo "✗ Archive illisible ou mot de passe incorrect : rien n'a été modifié"; exit 1; }
[ "$LINES" -gt 10 ] || { echo "✗ Archive vide : rien n'a été modifié"; exit 1; }
read_dump | grep -q "PostgreSQL database dump complete" || { echo "✗ Archive incomplète (dump interrompu) : rien n'a été modifié"; exit 1; }
echo "✓ Archive valide ($LINES lignes)"

echo ""
echo "⚠️  La base actuelle va être REMPLACÉE par : $(basename "$FILE")"
echo "    (une sauvegarde de sécurité de la base actuelle est faite juste avant)"
read -rp "Tapez « restaurer » pour continuer : " CONFIRM
[ "$CONFIRM" = "restaurer" ] || { echo "Annulé."; exit 0; }

echo "→ Sauvegarde de sécurité de la base actuelle…"
SKIP_REMOTE=1 bash scripts/db-backup.sh

echo "→ Arrêt de l'application…"
docker compose stop app >/dev/null 2>&1 || true
restart_app() { echo "→ Relance de l'application…"; docker compose start app >/dev/null 2>&1 || docker compose up -d app; }
trap restart_app EXIT

echo "→ Restauration (une seule transaction)…"
# Le schéma est recréé dans la même transaction : si une instruction échoue, tout est annulé
{ echo "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"; read_dump; } \
  | docker exec -i "$DB" psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 --single-transaction -q >/dev/null \
  || { echo "✗ Restauration échouée : la base est restée dans son état précédent"; exit 1; }
echo "✓ Restauration terminée"
