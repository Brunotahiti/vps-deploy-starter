#!/usr/bin/env bash
# Démarrage complet de ManaResto sur un Mac (première fois et suivantes).
# Prérequis : Docker Desktop, Node 22 (brew install node@22), pnpm (corepack enable pnpm).
set -euo pipefail
cd "$(dirname "$0")/.."

command -v docker >/dev/null || { echo "Docker Desktop est requis : https://www.docker.com/products/docker-desktop/"; exit 1; }
command -v pnpm >/dev/null || corepack enable pnpm

echo "→ PostgreSQL (Docker)…"
docker compose -f docker-compose.dev.yml up -d
until docker exec manaresto-dev-db pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done

if [ ! -f .env ]; then
  echo "→ Création du fichier .env…"
  cp .env.example .env
  sed -i.bak "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://postgres:postgres@localhost:5432/manaresto|" .env
  sed -i.bak "s|^SESSION_SECRET=.*|SESSION_SECRET=$(openssl rand -base64 32 | tr -d '\n')|" .env
  rm -f .env.bak
fi
# Base de test pour `pnpm test`
docker exec manaresto-dev-db psql -U postgres -tc "SELECT 1 FROM pg_database WHERE datname='manaresto_test'" | grep -q 1 || docker exec manaresto-dev-db createdb -U postgres manaresto_test

echo "→ Dépendances…"
pnpm install --frozen-lockfile
echo "→ Schéma de base de données…"
pnpm prisma migrate deploy
echo "→ Démo « Le Mana Beach » (ignorée si déjà présente)…"
pnpm db:seed

echo ""
echo "✅ Prêt. Lancement de ManaResto sur http://localhost:3000"
echo "   Connexion : demo@manaresto.pf / demo1234 (PIN 1234)"
echo "   Mode production (PWA + hors ligne) : pnpm build && pnpm start"
echo ""
exec pnpm dev
