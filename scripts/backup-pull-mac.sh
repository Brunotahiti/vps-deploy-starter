#!/usr/bin/env bash
# Rapatrie sur le Mac les sauvegardes du serveur (deuxième copie, gratuite, hors du serveur).
# Usage depuis le Mac : bash scripts/backup-pull-mac.sh
# Planifiable chaque jour avec le Calendrier ou launchd ; ne supprime jamais rien sur le Mac.
set -euo pipefail

VPS_HOST="${VPS_HOST:-187.127.105.242}"
VPS_USER="${VPS_USER:-root}"
KEY="${KEY:-$HOME/.ssh/manaresto_vps}"
DEST="${DEST:-$HOME/ManaResto-sauvegardes}"

mkdir -p "$DEST"
rsync -az --ignore-existing -e "ssh -i $KEY" "$VPS_USER@$VPS_HOST:/var/backups/manaresto/" "$DEST/"
echo "✓ Sauvegardes copiées dans $DEST ($(ls "$DEST" | wc -l | tr -d ' ') fichiers)"
ls -lt "$DEST" | head -4
