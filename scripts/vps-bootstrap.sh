#!/usr/bin/env bash
# Vérifications préalables sur le VPS avant de déployer ManaResto. Idempotent, en lecture seule
# sur l'infrastructure : ce script n'installe ni ne modifie JAMAIS Traefik, le pare-feu ou
# d'autres services du serveur. Il constate, et s'arrête avec un message clair si un prérequis manque.
# À exécuter en root sur le VPS (lancé par scripts/deploy-vps.sh).
set -euo pipefail

fail() { echo "✗ $1"; echo "  $2"; exit 1; }

command -v docker >/dev/null 2>&1 || fail "Docker n'est pas installé sur ce serveur." "Installez Docker Engine + le plugin compose, puis relancez le déploiement."
docker compose version >/dev/null 2>&1 || fail "Le plugin docker compose est absent." "Installez docker-compose-plugin, puis relancez."
docker info >/dev/null 2>&1 || fail "Le démon Docker ne répond pas." "Démarrez Docker (systemctl start docker), puis relancez."

docker network inspect traefik >/dev/null 2>&1 || fail "Le réseau Docker « traefik » n'existe pas." "ManaResto se branche sur le Traefik existant du serveur via ce réseau. Créez-le avec votre Traefik (docker network create traefik) et attachez-y Traefik."

if ! docker ps --format '{{.Names}} {{.Image}}' | grep -qi traefik; then
  fail "Aucun conteneur Traefik en cours d'exécution." "ManaResto ne démarre pas de reverse proxy : démarrez votre Traefik (réseau « traefik », entrypoints web/websecure, certresolver « letsencrypt »), puis relancez."
fi

echo "✓ Prérequis présents : Docker, réseau « traefik », Traefik en service (non modifiés)"
