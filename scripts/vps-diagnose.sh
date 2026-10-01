#!/usr/bin/env bash
# Diagnostic de performance du serveur (lecture seule : ne modifie rien).
# Sur le serveur : bash /opt/manaresto/scripts/vps-diagnose.sh
# Depuis le Mac  : ssh root@IP_DU_SERVEUR 'bash -s' < scripts/vps-diagnose.sh
set -uo pipefail

section() { printf '\n\033[1;34m== %s ==\033[0m\n' "$1"; }

section "Charge du processeur (à comparer au nombre de cœurs)"
echo "Cœurs : $(nproc)"
uptime

section "Mémoire et swap"
free -h
echo "→ Un swap très utilisé signale un manque de mémoire : c'est la première cause de lenteur."

section "Disque"
df -h / /var/lib/docker 2>/dev/null | sort -u
echo "→ Au-delà d'environ 85 % d'occupation, les performances chutent."

section "Espace utilisé par Docker"
docker system df 2>/dev/null

section "Plus gros journaux Docker"
find /var/lib/docker/containers -name '*-json.log' -printf '%s %p\n' 2>/dev/null \
  | sort -rn | head -10 \
  | awk '{printf "%8.1f Mo  %s\n", $1/1048576, $2}'

section "Consommation par conteneur"
docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}' 2>/dev/null

section "Conteneurs qui redémarrent en boucle"
docker ps -a --format '{{.Names}}' 2>/dev/null | while read -r c; do
  n=$(docker inspect -f '{{.RestartCount}}' "$c" 2>/dev/null || echo 0)
  [ "${n:-0}" -gt 0 ] && echo "$c : $n redémarrages"
done
echo "(rien au-dessus = tout va bien)"

section "10 processus les plus gourmands en processeur"
ps -eo pid,comm,%cpu,%mem --sort=-%cpu | head -11

section "10 processus les plus gourmands en mémoire"
ps -eo pid,comm,%cpu,%mem --sort=-%mem | head -11

section "Processus tués faute de mémoire (7 derniers jours)"
journalctl -k --since '7 days ago' 2>/dev/null | grep -i 'killed process' | tail -5 || true
echo "(rien au-dessus = tout va bien)"

section "Taille du journal système"
journalctl --disk-usage 2>/dev/null || true

section "Temps volé par l'hébergeur (colonne st)"
echo "→ Au-delà de 10 %, la machine physique de l'hébergeur est surchargée."
vmstat 1 5
