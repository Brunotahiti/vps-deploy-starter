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
echo "→ Configuration :"
echo "  App      : $APP_NAME"
echo "  Domaine  : $PUBLIC_HOST"
echo "  Port     : $APP_PORT"
echo "  Stack    : $FRAMEWORK"
echo ""
read -rp "Continuer ? [Y/n] : " CONFIRM
CONFIRM="${CONFIRM:-Y}"
if [[ "$CONFIRM" != "Y" && "$CONFIRM" != "y" ]]; then
  echo "Annulé."
  exit 0
fi

# Substituer les placeholders
echo ""
echo "→ Substitution des placeholders…"

PLACEHOLDERS=(
  "__APP_NAME__:$APP_NAME"
  "__PUBLIC_HOST__:$PUBLIC_HOST"
  "__APP_PORT__:$APP_PORT"
)

FILES_TO_PATCH=(
  "docker-compose.yml"
  ".env.vps.example"
  "scripts/sync-to-vps.sh"
  "scripts/setup-ci.sh"
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
  echo "  ✓ $f"
done

# Sélectionner le bon Dockerfile
echo ""
echo "→ Sélection du Dockerfile pour : $FRAMEWORK"

if [ -f "Dockerfile.$FRAMEWORK" ]; then
  mv "Dockerfile.$FRAMEWORK" Dockerfile
  # supprimer les autres
  rm -f Dockerfile.next Dockerfile.node Dockerfile.python Dockerfile.static 2>/dev/null || true
  echo "  ✓ Dockerfile sélectionné"
fi

# Substituer dans le Dockerfile aussi
if [ -f Dockerfile ]; then
  for p in "${PLACEHOLDERS[@]}"; do
    KEY="${p%%:*}"
    VAL="${p#*:}"
    sed -i.bak "s|$KEY|$VAL|g" Dockerfile
    rm -f Dockerfile.bak
  done
fi

# Nettoyer le README générique pour qu'il devienne propre au projet
if [ -f README.md ]; then
  mv README.md TEMPLATE-README.md
fi

cat > README.md <<EOF
# $APP_NAME

Déployé automatiquement sur https://$PUBLIC_HOST via GitHub Actions.

## Démarrer en local

\`\`\`bash
docker compose up
\`\`\`

## Déployer

\`\`\`bash
git add -A && git commit -m "..." && git push
# CI/CD fait le reste — voir .github/workflows/deploy.yml
\`\`\`

## Configuration initiale (une fois)

\`\`\`bash
bash scripts/setup-ci.sh
\`\`\`
EOF

# Supprimer init.sh (plus utile)
rm -f init.sh

echo ""
echo "✅ Initialisation terminée !"
echo ""
echo "Étapes suivantes :"
echo "  1. Code ton app (Dockerfile pré-adapté à $FRAMEWORK)"
echo "  2. bash scripts/setup-ci.sh   # configure SSH + secrets GitHub (UNE FOIS)"
echo "  3. git add -A && git commit -m 'Initial' && git push"
echo "  4. gh run watch                # suivre le déploiement live"
echo ""
echo "Ton app sera live sur https://$PUBLIC_HOST"
