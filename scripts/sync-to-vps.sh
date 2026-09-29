#!/usr/bin/env bash
# Sync manuel local → VPS (fallback si tu veux pousser sans passer par git push)
set -euo pipefail

VPS_HOST="${VPS_HOST:-root@187.127.105.242}"
VPS_PATH="${VPS_PATH:-/opt/manaresto}"

cd "$(dirname "$0")/.."

echo "→ Sync vers ${VPS_HOST}:${VPS_PATH}…"

ssh "$VPS_HOST" "mkdir -p $VPS_PATH"

rsync -avz --delete \
  --exclude node_modules \
  --exclude .next \
  --exclude .git \
  --exclude .vercel \
  --exclude .github \
  --exclude .env \
  --exclude .env.local \
  --exclude .env.production \
  --exclude .DS_Store \
  ./ "${VPS_HOST}:${VPS_PATH}/"

echo "✓ Synchronisation terminée"
echo ""
echo "Sur le VPS (si tu veux rebuild manuellement) :"
echo "  ssh $VPS_HOST"
echo "  cd $VPS_PATH && docker compose build app && docker compose up -d"
