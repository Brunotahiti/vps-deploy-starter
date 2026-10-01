#!/usr/bin/env bash
# Nettoyage prudent du serveur : libère le disque occupé par Docker et les journaux.
# Le serveur héberge d'autres sites derrière Traefik : ce script ne supprime AUCUN conteneur, AUCUN volume
# (bases de données, certificats traefik_traefik-letsencrypt) et aucune image encore utilisée par un conteneur.
# Usage : bash /opt/manaresto/scripts/vps-cleanup.sh
set -euo pipefail

echo "→ Disque avant :"
df -h / | tail -1

# Images orphelines (anciennes versions remplacées par un déploiement) et cache de construction de plus de 7 jours
docker image prune -f
docker builder prune -f --filter until=168h

# Journaux Docker trop gros : vidés (ceux des conteneurs créés avant la rotation automatique)
find /var/lib/docker/containers -name '*-json.log' -size +50M -exec truncate -s 0 {} \;

# Journal système limité à 200 Mo
journalctl --vacuum-size=200M 2>/dev/null || true

echo "→ Disque après :"
df -h / | tail -1
