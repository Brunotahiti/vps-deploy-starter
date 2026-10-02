#!/bin/sh
# Installation du boîtier de secours ManaResto sur un mini-PC (Ubuntu ou Debian, processeur x86-64).
#
#   curl -fsSL https://app.manaresto.com/box/install.sh -o install.sh && sudo sh install.sh
#
# Le script demande la clé du boîtier (Admin → Imprimantes & tiroir → Boîtier de secours), installe Docker si
# besoin, puis démarre le boîtier. Il peut être relancé sans risque (mise à jour de la configuration).
set -eu

CLOUD_URL="${CLOUD_URL:-https://app.manaresto.com}"
DIR="${BOX_DIR:-/opt/manaresto-box}"

say() { printf '\n\033[1;36m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m%s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || fail "Lancez le script en administrateur : sudo sh install.sh"
case "$(uname -m)" in
  x86_64|amd64) ;;
  *) fail "Processeur $(uname -m) non pris en charge : il faut un mini-PC x86-64 (Intel ou AMD)." ;;
esac

# Clé du boîtier : variable BOX_TOKEN, sinon déjà enregistrée, sinon demandée
if [ -z "${BOX_TOKEN:-}" ] && [ -f "$DIR/.env" ]; then BOX_TOKEN="$(sed -n 's/^BOX_TOKEN=//p' "$DIR/.env")"; fi
if [ -z "${BOX_TOKEN:-}" ]; then
  printf 'Clé du boîtier (mrbox_…) : '
  read -r BOX_TOKEN < /dev/tty
fi
case "$BOX_TOKEN" in mrbox_*) ;; *) fail "Clé invalide : elle commence par mrbox_" ;; esac

say "Vérification de la clé auprès de ManaResto…"
code="$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $BOX_TOKEN" "$CLOUD_URL/api/box/snapshot" || true)"
[ "$code" = "200" ] || fail "ManaResto refuse cette clé (réponse $code). Créez un nouveau boîtier dans l'administration."

if ! command -v docker >/dev/null 2>&1; then
  say "Installation de Docker…"
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || fail "Docker Compose est introuvable : installez le paquet docker-compose-plugin."
systemctl enable --now docker >/dev/null 2>&1 || true

mkdir -p "$DIR/data"
chmod 700 "$DIR"
cd "$DIR"

rand() { head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 40; }
# Secrets gardés d'une installation à l'autre (la base du boîtier n'est qu'une copie, mais autant ne rien casser)
POSTGRES_PASSWORD="$(sed -n 's/^POSTGRES_PASSWORD=//p' .env 2>/dev/null || true)"; [ -n "$POSTGRES_PASSWORD" ] || POSTGRES_PASSWORD="$(rand)"
BOX_SECRET="$(sed -n 's/^BOX_SECRET=//p' .env 2>/dev/null || true)"; [ -n "$BOX_SECRET" ] || BOX_SECRET="$(rand)"

umask 077
cat > .env <<EOF
CLOUD_URL=$CLOUD_URL
BOX_TOKEN=$BOX_TOKEN
BOX_SECRET=$BOX_SECRET
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
EOF
umask 022

curl -fsSL "$CLOUD_URL/box/bootstrap.mjs" -o bootstrap.mjs

cat > docker-compose.yml <<'EOF'
# Boîtier de secours ManaResto — généré par install.sh
x-logging: &logging
  driver: json-file
  options: { max-size: "10m", max-file: "3" }

services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    logging: *logging
    environment:
      POSTGRES_USER: manaresto
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: manaresto
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "127.0.0.1:55432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U manaresto -d manaresto"]
      interval: 5s
      timeout: 5s
      retries: 20

  box:
    image: node:22-alpine
    restart: unless-stopped
    logging: *logging
    # Réseau de la machine : ports 80/443 du mini-PC, adresse locale, imprimantes du restaurant
    network_mode: host
    env_file: .env
    environment:
      DATA_DIR: /data
      DATABASE_URL: postgresql://manaresto:${POSTGRES_PASSWORD}@127.0.0.1:55432/manaresto
    volumes:
      - ./data:/data
      - ./bootstrap.mjs:/bootstrap.mjs:ro
    command: ["node", "/bootstrap.mjs"]
    depends_on:
      db:
        condition: service_healthy

volumes:
  pgdata:
EOF

say "Démarrage du boîtier…"
# Images à jour si possible ; sinon (limite du registre, connexion lente) celles déjà présentes
docker compose pull -q || say "Mise à jour des images impossible pour l'instant : utilisation des images déjà présentes."
docker compose up -d

# Attente de la passerelle (premier démarrage : téléchargement de l'application, quelques minutes)
i=0
until curl -fsk -o /dev/null https://127.0.0.1/__box/status 2>/dev/null || curl -fs -o /dev/null http://127.0.0.1/__box/status 2>/dev/null; do
  i=$((i + 1))
  [ $i -le 120 ] || fail "Le boîtier ne répond pas encore. Suivez le démarrage avec : cd $DIR && docker compose logs -f box"
  sleep 5
done

HOST="$(cat "$DIR/data/tls/host" 2>/dev/null || true)"
say "Boîtier de secours prêt."
if [ -n "$HOST" ]; then
  echo "Sur chaque tablette, ouvrez : https://$HOST  puis « Installer l'application » (ou Partager → Sur l'écran d'accueil)."
else
  IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  echo "Adresse HTTPS non configurée sur ManaResto : le boîtier répond sur http://$IP (sans connexion par PIN hors ligne ni installation de l'application)."
fi
echo "État du boîtier : cd $DIR && docker compose logs -f box"
