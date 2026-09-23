#!/usr/bin/env bash
# Nettoyage du VPS : libère le disque occupé par Docker et les journaux.
# Ne touche PAS aux volumes (tes bases de données sont préservées).
# Usage : bash /opt/__APP_NAME__/scripts/vps-cleanup.sh
# Cron hebdo conseillé : 0 4 * * 0 /opt/__APP_NAME__/scripts/vps-cleanup.sh
set -euo pipefail

echo "→ Avant :"
df -h / | tail -1

# Images non utilisées par un conteneur, et cache de build
docker image prune -af --filter until=168h
docker builder prune -af --filter until=168h
docker container prune -f

# Vider les logs Docker existants (la rotation ne s'applique qu'aux nouveaux conteneurs)
find /var/lib/docker/containers -name '*-json.log' -size +50M -exec truncate -s 0 {} \;

# Limiter le journal système
journalctl --vacuum-size=200M 2>/dev/null || true

echo "→ Après :"
df -h / | tail -1
