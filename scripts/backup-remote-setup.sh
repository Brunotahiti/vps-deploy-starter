#!/usr/bin/env bash
# Configure une fois la destination des copies de sauvegarde hors du serveur (à lancer SUR le serveur).
# Usage : bash /opt/manaresto/scripts/backup-remote-setup.sh
# rclone (dans Docker) propose des dizaines de stockages : Backblaze B2, Cloudflare R2, Scaleway, OVH, Google Drive, Dropbox…
# Ensuite, dans /opt/manaresto/.env : BACKUP_REMOTE=<nom du stockage>:<dossier> et BACKUP_PASSPHRASE=<phrase secrète>.
set -euo pipefail

CONFIG_DIR="${RCLONE_CONFIG_DIR:-/root/.config/rclone}"
mkdir -p "$CONFIG_DIR"
echo "→ Assistant rclone : choisissez « n » (nouveau stockage), donnez-lui un nom court (ex. b2), puis suivez les questions."
docker run --rm -it -v "$CONFIG_DIR:/config/rclone" rclone/rclone:1 config
echo ""
echo "→ Stockages configurés :"
docker run --rm -v "$CONFIG_DIR:/config/rclone" rclone/rclone:1 listremotes
echo ""
echo "Ajoutez maintenant dans /opt/manaresto/.env, par exemple :"
echo "  BACKUP_REMOTE=b2:manaresto-sauvegardes"
echo "  BACKUP_PASSPHRASE=une-longue-phrase-secrete-a-garder-aussi-ailleurs"
echo "Puis testez : bash /opt/manaresto/scripts/db-backup.sh"
