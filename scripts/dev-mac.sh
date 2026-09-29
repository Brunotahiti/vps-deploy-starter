#!/usr/bin/env bash
# Démarrage complet de ManaResto sur un Mac (première fois et suivantes).
# PostgreSQL : Docker Desktop s'il est installé, sinon Homebrew (installé automatiquement).
# Node 22 : installé via Homebrew s'il manque. pnpm : activé via corepack.
set -euo pipefail
cd "$(dirname "$0")/.."

# ---------- Homebrew (nécessaire si Docker ou Node manquent)
ensure_brew() {
  if ! command -v brew >/dev/null; then
    echo "→ Installation de Homebrew…"
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv)"
  fi
}

# ---------- Node 22 + pnpm
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  ensure_brew
  echo "→ Installation de Node 22…"
  brew install node@22
  brew link --overwrite --force node@22 >/dev/null 2>&1 || true
  export PATH="$(brew --prefix node@22)/bin:$PATH"
fi
command -v pnpm >/dev/null || corepack enable pnpm 2>/dev/null || npm install -g pnpm@10

# ---------- PostgreSQL : Docker si présent, sinon Homebrew
DB_URL="postgresql://postgres:postgres@localhost:5432/manaresto"
if command -v docker >/dev/null && docker info >/dev/null 2>&1; then
  echo "→ PostgreSQL (Docker)…"
  docker compose -f docker-compose.dev.yml up -d
  until docker exec manaresto-dev-db pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
  PSQL="docker exec -i manaresto-dev-db psql -U postgres"
else
  ensure_brew
  if ! brew list postgresql@16 >/dev/null 2>&1; then
    echo "→ Installation de PostgreSQL 16 (Homebrew)…"
    brew install postgresql@16
  fi
  export PATH="$(brew --prefix postgresql@16)/bin:$PATH"
  brew services start postgresql@16 >/dev/null
  until pg_isready -h localhost -p 5432 >/dev/null 2>&1; do sleep 1; done
  # Rôle "postgres" avec mot de passe pour une URL identique à Docker
  psql -h localhost -d postgres -tc "SELECT 1 FROM pg_roles WHERE rolname='postgres'" | grep -q 1 || psql -h localhost -d postgres -c "CREATE ROLE postgres LOGIN SUPERUSER PASSWORD 'postgres'"
  psql -h localhost -d postgres -c "ALTER ROLE postgres WITH PASSWORD 'postgres'" >/dev/null
  PSQL="psql -h localhost -U postgres -d postgres"
fi
$PSQL -tc "SELECT 1 FROM pg_database WHERE datname='manaresto'" | grep -q 1 || $PSQL -c "CREATE DATABASE manaresto" >/dev/null
$PSQL -tc "SELECT 1 FROM pg_database WHERE datname='manaresto_test'" | grep -q 1 || $PSQL -c "CREATE DATABASE manaresto_test" >/dev/null

# ---------- .env
if [ ! -f .env ]; then
  echo "→ Création du fichier .env…"
  cp .env.example .env
  sed -i.bak "s|^DATABASE_URL=.*|DATABASE_URL=$DB_URL|" .env
  sed -i.bak "s|^SESSION_SECRET=.*|SESSION_SECRET=$(openssl rand -base64 32 | tr -d '\n')|" .env
  rm -f .env.bak
fi

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
