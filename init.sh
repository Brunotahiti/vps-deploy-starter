#!/usr/bin/env bash
# Initialisation interactive du template VPS deploy
set -euo pipefail

cd "$(dirname "$0")"

echo ""
echo "🚀 Initialisation du déploiement VPS"
echo "===================================="
echo ""

read -rp "Nom du projet (kebab-case, ex: mon-projet)  : " APP_NAME
read -rp "Domaine ou sous-domaine (ex: monprojet.pf)  : " PUBLIC_HOST
read -rp "Port interne de l'app (défaut 3000)         : " APP_PORT
APP_PORT="${APP_PORT:-3000}"

echo ""
echo "Framework :"
echo "  1) Next.js (standalone)"
echo "  2) Node.js / Express / Fastify / NestJS"
echo "  3) Python / FastAPI / Django"
echo "  4) Static (HTML/CSS/JS)"
read -rp "Choix (1-4) : " FRAMEWORK_CHOICE

case "$FRAMEWORK_CHOICE" in
  1) FRAMEWORK="next" ;;
  2) FRAMEWORK="node" ;;
  3) FRAMEWORK="python" ;;
  4) FRAMEWORK="static" ;;
  *) echo "Choix invalide" && exit 1 ;;
esac

echo ""
read -rp "Ajouter une base Postgres au compose ? [y/N] : " ADD_PG
ADD_PG="${ADD_PG:-N}"

echo ""
echo "→ Configuration :"
echo "  App      : $APP_NAME"
echo "  Domaine  : $PUBLIC_HOST"
echo "  Port     : $APP_PORT"
echo "  Stack    : $FRAMEWORK"
echo "  Postgres : $ADD_PG"
echo ""
read -rp "Continuer ? [Y/n] : " CONFIRM
CONFIRM="${CONFIRM:-Y}"
if [[ "$CONFIRM" != "Y" && "$CONFIRM" != "y" ]]; then
  echo "Annulé."
  exit 0
fi

# Substituer les placeholders dans tous les fichiers concernés
echo ""
echo "→ Substitution des placeholders…"

PLACEHOLDERS=(
  "__APP_NAME__:$APP_NAME"
  "__PUBLIC_HOST__:$PUBLIC_HOST"
  "__APP_PORT__:$APP_PORT"
)

FILES_TO_PATCH=(
  "docker-compose.yml"
  "compose-postgres-snippet.yml"
  ".env.vps.example"
  "scripts/sync-to-vps.sh"
  "scripts/setup-ci.sh"
  "scripts/db-backup.sh"
  "scripts/db-restore.sh"
  ".github/workflows/deploy.yml"
)

for f in "${FILES_TO_PATCH[@]}"; do
  [ -f "$f" ] || continue
  for p in "${PLACEHOLDERS[@]}"; do
    KEY="${p%%:*}"
    VAL="${p#*:}"
    sed -i.bak "s|$KEY|$VAL|g" "$f"
    rm -f "$f.bak"
  done
done

# Sélectionner le bon Dockerfile
echo "→ Sélection du Dockerfile pour : $FRAMEWORK"
if [ -f "Dockerfile.$FRAMEWORK" ]; then
  mv "Dockerfile.$FRAMEWORK" Dockerfile
  rm -f Dockerfile.next Dockerfile.node Dockerfile.python Dockerfile.static 2>/dev/null || true
  for p in "${PLACEHOLDERS[@]}"; do
    KEY="${p%%:*}"; VAL="${p#*:}"
    sed -i.bak "s|$KEY|$VAL|g" Dockerfile
    rm -f Dockerfile.bak
  done
fi

# Ajouter Postgres si demandé
if [[ "$ADD_PG" == "y" || "$ADD_PG" == "Y" ]]; then
  echo "→ Ajout de la base Postgres au compose…"

  # Générer un mot de passe Postgres aléatoire
  PG_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)

  # Injecter le snippet Postgres dans le compose
  # On insère avant la ligne "networks:" finale
  TMP=$(mktemp)
  awk -v inject_file=compose-postgres-snippet.yml '
    /^networks:/ && !done {
      while ((getline line < inject_file) > 0) print line
      print ""
      done = 1
    }
    { print }
  ' docker-compose.yml > "$TMP"
  mv "$TMP" docker-compose.yml

  # Ajouter le service "app" au réseau "internal" en plus de traefik
  sed -i.bak '/- traefik$/a\
      - internal' docker-compose.yml
  rm -f docker-compose.yml.bak

  # Ajouter le réseau "internal" et le volume
  cat >> docker-compose.yml <<EOF
  internal:
    driver: bridge

volumes:
  ${APP_NAME}-pgdata:
EOF

  # Ajouter DATABASE_URL au template env
  cat >> .env.vps.example <<EOF

# Postgres (généré par init.sh)
POSTGRES_PASSWORD=$PG_PASSWORD
DATABASE_URL=postgres://${APP_NAME}:${PG_PASSWORD}@db:5432/${APP_NAME}
EOF

  # Rendre les scripts exécutables
  chmod +x scripts/db-backup.sh scripts/db-restore.sh
  mkdir -p db-init
  echo "-- Place tes scripts SQL d'initialisation ici" > db-init/.gitkeep

  echo "  ✓ Service db ajouté au compose"
  echo "  ✓ Mot de passe Postgres généré : POSTGRES_PASSWORD"
  echo "  ✓ DATABASE_URL ajouté à .env.vps.example"
  echo "  ✓ Scripts db-backup.sh / db-restore.sh prêts"
else
  rm -f compose-postgres-snippet.yml scripts/db-backup.sh scripts/db-restore.sh
  rm -rf db-init 2>/dev/null || true
fi

# Nettoyer le snippet
rm -f compose-postgres-snippet.yml

# Remplacer le README générique par un README de projet
if [ -f README.md ]; then
  mv README.md TEMPLATE-README.md
fi

cat > README.md <<EOF
# $APP_NAME

Déployé automatiquement sur https://$PUBLIC_HOST via GitHub Actions.

## Démarrer en local

\`\`\`bash
cp .env.vps.example .env
# Remplis les vraies valeurs
docker compose up
\`\`\`

## Déployer

\`\`\`bash
git add -A && git commit -m "..." && git push
# CI/CD fait le reste (voir .github/workflows/deploy.yml)
\`\`\`

## Configuration initiale (une fois)

\`\`\`bash
bash scripts/setup-ci.sh
\`\`\`
EOF

if [[ "$ADD_PG" == "y" || "$ADD_PG" == "Y" ]]; then
  cat >> README.md <<EOF

## Base de données

Postgres 16 dans un container Docker, données persistées dans le volume \`${APP_NAME}-pgdata\`.

### Sauvegarde quotidienne (à activer sur le VPS)

\`\`\`bash
# Sur le VPS
crontab -e
# Ajouter :
0 3 * * * /opt/$APP_NAME/scripts/db-backup.sh
\`\`\`

### Restauration

\`\`\`bash
bash scripts/db-restore.sh /var/backups/$APP_NAME/$APP_NAME-YYYYMMDD-HHMMSS.sql.gz
\`\`\`

### Accès console

\`\`\`bash
docker exec -it $APP_NAME-db psql -U $APP_NAME
\`\`\`
EOF
fi

rm -f init.sh

echo ""
echo "✅ Initialisation terminée !"
echo ""
echo "Étapes suivantes :"
echo "  1. Code ton app (Dockerfile pré-adapté à $FRAMEWORK)"
echo "  2. bash scripts/setup-ci.sh   # configure SSH + secrets GitHub (UNE FOIS)"
echo "  3. cp .env.vps.example .env   # adapter pour le local si tu veux"
if [[ "$ADD_PG" == "y" || "$ADD_PG" == "Y" ]]; then
echo "     ⚠️  Le POSTGRES_PASSWORD est dans .env.vps.example. NE LE COMMIT PAS."
fi
echo "  4. git add -A && git commit -m 'Initial' && git push"
echo "  5. gh run watch                # suivre le déploiement live"
echo ""
echo "Ton app sera live sur https://$PUBLIC_HOST"
