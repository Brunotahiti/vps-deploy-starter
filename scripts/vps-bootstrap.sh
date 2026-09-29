#!/usr/bin/env bash
# Prépare un VPS Ubuntu/Debian (Hostinger) pour ManaResto. Idempotent : peut être relancé.
# À exécuter EN ROOT SUR LE VPS (lancé automatiquement par scripts/deploy-vps.sh).
#   - Docker Engine + Compose plugin
#   - réseau Docker "traefik" et Traefik v3 avec certificats Let's Encrypt
#   - pare-feu UFW (22, 80, 443) si disponible
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/manaresto}"
ACME_EMAIL="${ACME_EMAIL:-}"

if ! command -v docker >/dev/null 2>&1; then
  echo "→ Installation de Docker…"
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || { echo "Le plugin docker compose est requis (docker-compose-plugin)."; exit 1; }
systemctl enable --now docker >/dev/null 2>&1 || true

docker network inspect traefik >/dev/null 2>&1 || docker network create traefik

if ! docker ps --format '{{.Names}}' | grep -qx traefik; then
  [ -n "$ACME_EMAIL" ] || { echo "ACME_EMAIL est requis pour démarrer Traefik (certificats Let's Encrypt)."; exit 1; }
  echo "→ Démarrage de Traefik (HTTPS automatique)…"
  mkdir -p "$APP_DIR/deploy/traefik"
  echo "ACME_EMAIL=$ACME_EMAIL" > "$APP_DIR/deploy/traefik/.env"
  docker compose --project-directory "$APP_DIR/deploy/traefik" -f "$APP_DIR/deploy/traefik/docker-compose.yml" up -d
else
  echo "→ Traefik déjà en service"
fi

if command -v ufw >/dev/null 2>&1; then
  ufw allow 22/tcp >/dev/null 2>&1 || true
  ufw allow 80/tcp >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
fi
echo "✓ VPS prêt (Docker, réseau traefik, Traefik)"
