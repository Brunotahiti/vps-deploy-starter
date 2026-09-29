#!/usr/bin/env bash
# Configure SSH + secrets GitHub Actions pour le déploiement automatique.
# À lancer UNE SEULE FOIS par projet.
set -euo pipefail

VPS_HOST="${VPS_HOST:-187.127.105.242}"
VPS_USER="${VPS_USER:-root}"
APP_NAME="manaresto"
PUBLIC_HOST="manaresto.pf"
VPS_PATH="/opt/$APP_NAME"
KEY_PATH="$HOME/.ssh/manaresto_vps"

echo ""
echo "🔐 Configuration CI/CD pour $APP_NAME"
echo "======================================"
echo ""
echo "VPS         : $VPS_USER@$VPS_HOST"
echo "Path VPS    : $VPS_PATH"
echo "Domaine     : $PUBLIC_HOST"
echo "Clé SSH     : $KEY_PATH"
echo ""

# Vérifier que gh CLI est connecté
if ! gh auth status >/dev/null 2>&1; then
  echo "❌ gh CLI n'est pas connecté. Sur Mac : brew install gh && gh auth login"
  exit 1
fi

# 1. Générer la clé SSH si pas déjà existe
if [ ! -f "$KEY_PATH" ]; then
  echo "→ Génération de la clé SSH dédiée…"
  ssh-keygen -t ed25519 -C "github-actions-$APP_NAME" -f "$KEY_PATH" -N "" -q
else
  echo "→ Clé SSH déjà existante, on la réutilise"
fi

# 2. Ajouter la clé PUBLIQUE au VPS
echo "→ Ajout de la clé publique au VPS (mot de passe root demandé)…"
ssh-copy-id -i "${KEY_PATH}.pub" "$VPS_USER@$VPS_HOST"

# 3. Tester
echo "→ Test de la connexion SSH (ne doit pas demander de mot de passe)…"
ssh -i "$KEY_PATH" -o StrictHostKeyChecking=no "$VPS_USER@$VPS_HOST" 'echo "✅ SSH OK"'

# 4. Créer le dossier sur le VPS
echo "→ Création du dossier projet sur le VPS…"
ssh -i "$KEY_PATH" "$VPS_USER@$VPS_HOST" "mkdir -p $VPS_PATH"

# 5. Enregistrer les secrets GitHub
echo "→ Enregistrement des secrets GitHub Actions…"
gh secret set VPS_SSH_KEY < "$KEY_PATH"
gh secret set VPS_HOST -b "$VPS_HOST"
gh secret set VPS_USER -b "$VPS_USER"
gh secret set VPS_PATH -b "$VPS_PATH"
gh secret set PUBLIC_HOST -b "$PUBLIC_HOST"

echo ""
echo "→ Secrets configurés :"
gh secret list

echo ""
echo "✅ Configuration CI/CD terminée !"
echo ""
echo "Prochaine étape :"
echo "  git add -A && git commit -m 'Initial deploy' && git push"
echo "  gh run watch"
echo ""
