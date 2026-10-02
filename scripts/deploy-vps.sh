#!/usr/bin/env bash
# Déploiement de ManaResto sur le VPS Hostinger, depuis le Mac, en une commande.
#   bash scripts/deploy-vps.sh
# Variables facultatives : VPS_HOST (défaut 187.127.105.242), VPS_USER (root), PUBLIC_HOST (domaine), SEED_DEMO (true/false)
# Le serveur doit déjà disposer de Docker et de son propre Traefik (réseau « traefik », certresolver « letsencrypt »).
# Ce script ne modifie jamais Traefik ni la configuration du serveur : il déploie uniquement les conteneurs ManaResto.
# Prérequis Mac : ssh, rsync (inclus dans macOS). Le mot de passe root du VPS est demandé au premier accès (ssh-copy-id).
set -euo pipefail
cd "$(dirname "$0")/.."

VPS_HOST="${VPS_HOST:-187.127.105.242}"
VPS_USER="${VPS_USER:-root}"
VPS_PATH="${VPS_PATH:-/opt/manaresto}"
TARGET="$VPS_USER@$VPS_HOST"

echo ""
echo "🚀 Déploiement ManaResto → $TARGET:$VPS_PATH"
echo "=============================================="
# Domaine : proposé depuis le .env déjà présent sur le VPS (Entrée pour le garder), sinon demandé.
KEY="$HOME/.ssh/manaresto_vps"
if [ -z "${PUBLIC_HOST:-}" ]; then
  CURRENT_HOST=$(ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=8 "$TARGET" "grep -s '^PUBLIC_HOST=' $VPS_PATH/.env | cut -d= -f2-" 2>/dev/null | tr -d '[:space:]:' || true)
  if [ -n "$CURRENT_HOST" ]; then
    read -rp "Nom de domaine de l'application [$CURRENT_HOST] : " PUBLIC_HOST
    PUBLIC_HOST="${PUBLIC_HOST:-$CURRENT_HOST}"
  else
    read -rp "Nom de domaine de l'application (ex. manaresto.manaprocess.cloud) : " PUBLIC_HOST
  fi
fi
# Nettoyage : espaces, « : » ou « / » parasites, préfixe http(s)://, majuscules
PUBLIC_HOST=$(printf '%s' "$PUBLIC_HOST" | tr -d '[:space:]' | tr 'A-Z' 'a-z' | sed -E 's|^https?://||; s|[/:]+$||')
if ! printf '%s' "$PUBLIC_HOST" | grep -Eq '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$'; then
  echo "✗ Nom de domaine invalide : « $PUBLIC_HOST » (attendu : manaresto.manaprocess.cloud)" >&2
  exit 1
fi
# Le nom nu et www sont réservés au site vitrine : l'application vit sur un sous-domaine (app.manaresto.com)
case "$PUBLIC_HOST" in
  manaresto.com|www.manaresto.com)
    echo "✗ « $PUBLIC_HOST » est réservé au site vitrine. Pour l'application, répondez app.manaresto.com (ou relancez avec PUBLIC_HOST=app.manaresto.com)." >&2
    exit 1 ;;
esac
# Ancien domaine conservé comme alias (PUBLIC_HOST_ALT) quand on change de domaine, sauf s'il est réservé au site
if [ -z "${PUBLIC_HOST_ALT:-}" ]; then
  PREV_HOST=$(ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=8 "$TARGET" "grep -s '^PUBLIC_HOST=' $VPS_PATH/.env | cut -d= -f2-" 2>/dev/null | tr -d '[:space:]:' || true)
  PREV_ALT=$(ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=8 "$TARGET" "grep -s '^PUBLIC_HOST_ALT=' $VPS_PATH/.env | cut -d= -f2-" 2>/dev/null | tr -d '[:space:]' || true)
  case "$PREV_HOST" in ""|"$PUBLIC_HOST"|manaresto.com|www.manaresto.com) PUBLIC_HOST_ALT="$PREV_ALT" ;; *) PUBLIC_HOST_ALT="$PREV_HOST" ;; esac
  case "$PUBLIC_HOST_ALT" in manaresto.com|www.manaresto.com|"$PUBLIC_HOST") PUBLIC_HOST_ALT="" ;; esac
fi
if [ -n "$PUBLIC_HOST_ALT" ] && ! printf '%s' "$PUBLIC_HOST_ALT" | grep -Eq '^[A-Za-z0-9.-]+$'; then echo "✗ Alias de domaine invalide : $PUBLIC_HOST_ALT"; exit 1; fi
if [ -z "${SEED_DEMO:-}" ]; then
  read -rp "Charger le restaurant de démonstration « Le Mana Beach » ? [Y/n] : " SD
  SEED_DEMO=$([ "${SD:-Y}" = "n" ] || [ "${SD:-Y}" = "N" ] && echo false || echo true)
fi
echo ""
echo "  Domaine  : $PUBLIC_HOST   (doit pointer vers $VPS_HOST — enregistrement DNS A)"
[ -n "$PUBLIC_HOST_ALT" ] && echo "  Alias    : $PUBLIC_HOST_ALT   (ancien domaine, toujours servi)"
echo "  Démo     : $SEED_DEMO"
echo ""

# 1. Accès SSH sans mot de passe (clé dédiée)
if [ ! -f "$KEY" ]; then
  ssh-keygen -t ed25519 -C "manaresto-deploy" -f "$KEY" -N "" -q
fi
if ! ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=8 "$TARGET" true 2>/dev/null; then
  echo "→ Copie de la clé SSH sur le VPS (mot de passe root demandé une fois)…"
  ssh-copy-id -i "$KEY.pub" "$TARGET"
fi
SSH="ssh -i $KEY -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -o ServerAliveCountMax=20 $TARGET"

# 2. Vérification des prérequis du VPS (Docker et Traefik existants — jamais modifiés)
$SSH "mkdir -p $VPS_PATH"
echo "→ Envoi du code…"
rsync -az --delete -e "ssh -i $KEY" \
  --exclude /node_modules --exclude /.next --exclude /.git --exclude /.github --exclude /.env --exclude /.env.local \
  --exclude /src/generated --exclude /playwright-report --exclude /test-results --exclude .DS_Store \
  ./ "$TARGET:$VPS_PATH/"
echo "→ Vérification des prérequis du VPS…"
$SSH "bash $VPS_PATH/scripts/vps-bootstrap.sh"

# 2 bis. Site vitrine : version des styles et scripts = commit déployé (le navigateur et Cloudflare rechargent les nouveaux fichiers)
BUILD_ID=$(git rev-parse --short=12 HEAD 2>/dev/null || date +%Y%m%d%H%M)
$SSH "cd $VPS_PATH && sed -i -E 's/\.(css|js)\?v=[A-Za-z0-9]+/.\1?v=$BUILD_ID/g' site/*.html"

# 3. Fichier .env de production (créé une seule fois, mots de passe générés sur le VPS)
$SSH "cd $VPS_PATH && if [ ! -f .env ]; then
  cp .env.vps.example .env
  chmod 600 .env
  PG=\$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)
  SS=\$(openssl rand -base64 48 | tr -d '\n')
  sed -i \"s|^PUBLIC_HOST=.*|PUBLIC_HOST=$PUBLIC_HOST|; s|^PUBLIC_URL=.*|PUBLIC_URL=https://$PUBLIC_HOST|; s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=\$PG|; s|^SESSION_SECRET=.*|SESSION_SECRET=\$SS|; s|^SEED_DEMO=.*|SEED_DEMO=$SEED_DEMO|\" .env
  echo '  ✓ .env créé (mots de passe générés)'
else
  sed -i \"s|^PUBLIC_HOST=.*|PUBLIC_HOST=$PUBLIC_HOST|; s|^PUBLIC_URL=.*|PUBLIC_URL=https://$PUBLIC_HOST|\" .env
  sed -i '/^PUBLIC_HOST_ALT=/d' .env
  [ -n '$PUBLIC_HOST_ALT' ] && printf 'PUBLIC_HOST_ALT=%s\n' '$PUBLIC_HOST_ALT' >> .env
  grep -q '^SITE_HOST=' .env || printf '\nSITE_HOST=www.manaresto.com\nSITE_HOST_ALT=manaresto.com\n' >> .env
  sed -i \"s|^SEED_DEMO=.*|SEED_DEMO=$SEED_DEMO|\" .env
  echo '  ✓ .env existant conservé (mots de passe inchangés)'
fi"

# Console plateforme : PLATFORM_ADMIN_EMAILS=vous@exemple.com bash scripts/deploy-vps.sh (enregistré dans le .env du VPS)
if [ -n "${PLATFORM_ADMIN_EMAILS:-}" ]; then
  if ! printf '%s' "$PLATFORM_ADMIN_EMAILS" | grep -Eq '^[A-Za-z0-9@._+,-]+$'; then echo "✗ PLATFORM_ADMIN_EMAILS invalide (adresses séparées par des virgules, sans espace)"; exit 1; fi
  $SSH "cd $VPS_PATH && sed -i '/^PLATFORM_ADMIN_EMAILS=/d' .env && printf '\nPLATFORM_ADMIN_EMAILS=%s\n' '$PLATFORM_ADMIN_EMAILS' >> .env"
  echo "  ✓ Console plateforme ouverte à : $PLATFORM_ADMIN_EMAILS"
fi
# Alertes e-mail (nouvelle inscription, demande de démo) : PLATFORM_NOTIFY_EMAILS=a@x.com,b@y.com bash scripts/deploy-vps.sh
if [ -n "${PLATFORM_NOTIFY_EMAILS:-}" ]; then
  if ! printf '%s' "$PLATFORM_NOTIFY_EMAILS" | grep -Eq '^[A-Za-z0-9@._+,-]+$'; then echo "✗ PLATFORM_NOTIFY_EMAILS invalide (adresses séparées par des virgules, sans espace)"; exit 1; fi
  $SSH "cd $VPS_PATH && sed -i '/^PLATFORM_NOTIFY_EMAILS=/d' .env && printf '\nPLATFORM_NOTIFY_EMAILS=%s\n' '$PLATFORM_NOTIFY_EMAILS' >> .env"
  echo "  ✓ Alertes (inscriptions, démos) envoyées à : $PLATFORM_NOTIFY_EMAILS"
fi

# 4. Construction et démarrage (base → migrations/seed → application)
echo "→ Construction des images et démarrage (2 à 5 minutes la première fois)…"
BUILD_ID=$(git rev-parse --short=12 HEAD 2>/dev/null || date +%Y%m%d%H%M)
# Sauvegarde de la base juste avant les migrations (si elle existe déjà) ; échec de la sauvegarde = déploiement interrompu
$SSH "cd $VPS_PATH && if docker ps --format '{{.Names}}' | grep -qx \"\${APP_NAME:-manaresto}-db\"; then SKIP_REMOTE=1 bash scripts/db-backup.sh; fi"
$SSH "cd $VPS_PATH && set -a && . ./.env && set +a && export BUILD_ID=$BUILD_ID && docker compose build migrate app && docker compose up -d --remove-orphans && (docker compose exec -T site nginx -s reload < /dev/null >/dev/null 2>&1 || true) && { [ \"\${SEED_DEMO:-}\" != true ] || docker compose run --rm --no-deps -T migrate pnpm tsx prisma/seed.ts < /dev/null || echo 'Démo non rafraîchie (application en ligne)'; } && docker image prune -f >/dev/null && docker builder prune -f --filter until=168h >/dev/null && docker compose ps"

# 5. Sauvegarde quotidienne à 3 h, heure de Tahiti (13 h UTC : le serveur est en UTC) — uniquement la ligne ManaResto de la crontab
# Démo vivante : rafraîchie chaque heure (activité du jour, journées manquantes) quand SEED_DEMO=true
$SSH "chmod +x $VPS_PATH/scripts/db-backup.sh; cd $VPS_PATH && set -a && . ./.env && set +a; (crontab -l 2>/dev/null | grep -v '$VPS_PATH/scripts/db-backup.sh' | grep -v 'manaresto-demo.log'; echo '0 13 * * * $VPS_PATH/scripts/db-backup.sh >> /var/log/manaresto-backup.log 2>&1'; if [ \"\${SEED_DEMO:-}\" = true ]; then echo '17 * * * * cd $VPS_PATH && flock -n /tmp/manaresto-demo.lock docker compose run --rm --no-deps -T migrate pnpm tsx prisma/seed.ts >> /var/log/manaresto-demo.log 2>&1'; fi) | crontab -"

# 6. Vérification
echo "→ Vérification…"
for i in 1 2 3 4 5 6; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://$PUBLIC_HOST/api/health") || STATUS=000
  [ "$STATUS" = "200" ] && break
  sleep 10
done
echo ""
if [ "$STATUS" = "200" ]; then
  echo "✅ ManaResto est en ligne : https://$PUBLIC_HOST"
  [ "$SEED_DEMO" = "true" ] && echo "   Démo : demo@manaresto.pf / demo1234 (PIN 1234) — pensez à changer le mot de passe."
else
  echo "⚠️  https://$PUBLIC_HOST/api/health répond $STATUS depuis cette machine."
  # Diagnostic depuis le VPS : l'application répond-elle, et Traefik connaît-il le routeur ?
  APP_OK=$($SSH "docker exec manaresto wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1 && echo oui || echo non")
  ROUTE=$($SSH "curl -s -o /dev/null -w '%{http_code}' -H 'Host: $PUBLIC_HOST' http://127.0.0.1/api/health || echo 000")
  DNS_IP=$(dig +short "$PUBLIC_HOST" 2>/dev/null | tail -n1)
  echo "   Application démarrée sur le VPS : $APP_OK"
  echo "   Routeur Traefik pour $PUBLIC_HOST : HTTP $ROUTE (30x = routeur en place, 404 = routeur absent)"
  echo "   DNS vu depuis cette machine : ${DNS_IP:-aucune réponse} (attendu : $VPS_HOST)"
  if [ "$APP_OK" = "oui" ] && [ "$ROUTE" != "404" ] && [ "$ROUTE" != "000" ]; then
    echo "   → Tout est en place côté serveur : le DNS se propage ou le certificat est en cours d'émission. Réessayez dans 1 à 2 minutes."
  else
    echo "   → Journaux : ssh -i $KEY $TARGET 'cd $VPS_PATH && docker compose logs --tail=100 app migrate'"
  fi
fi
echo ""
echo "Commandes utiles :"
echo "  Mettre à jour   : bash scripts/deploy-vps.sh (ou git push après scripts/setup-ci.sh)"
echo "  Journaux        : ssh -i $KEY $TARGET 'cd $VPS_PATH && docker compose logs -f app'"
echo "  Sauvegarde      : ssh -i $KEY $TARGET '$VPS_PATH/scripts/db-backup.sh'"
