#!/usr/bin/env bash
# Diagnostic de performance du VPS (lecture seule, ne modifie rien).
# Usage sur le VPS : bash /opt/__APP_NAME__/scripts/vps-diagnose.sh
# Ou depuis ta machine : ssh root@TON_VPS 'bash -s' < scripts/vps-diagnose.sh
set -uo pipefail

section() { printf '\n\033[1;34m== %s ==\033[0m\n' "$1"; }

section "Charge CPU (load average vs nombre de cœurs)"
echo "Cœurs : $(nproc)"
uptime

section "Mémoire et swap"
free -h
echo
echo "→ Si 'Swap used' est élevé, le VPS manque de RAM : c'est la cause n°1 de lenteur."

section "Disque"
df -h / /var/lib/docker 2>/dev/null | sort -u
echo
echo "→ Au-delà de ~85 % d'occupation, les performances chutent."

section "Espace utilisé par Docker"
docker system df 2>/dev/null

section "Plus gros fichiers de logs Docker"
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
echo "(rien au-dessus = OK)"

section "Top 10 processus (CPU)"
ps -eo pid,comm,%cpu,%mem --sort=-%cpu | head -11

section "Top 10 processus (RAM)"
ps -eo pid,comm,%cpu,%mem --sort=-%mem | head -11

section "Tueur OOM (processus tués faute de RAM)"
dmesg -T 2>/dev/null | grep -i 'killed process' | tail -5 || true
journalctl -k --since '7 days ago' 2>/dev/null | grep -i 'killed process' | tail -5 || true
echo "(rien au-dessus = OK)"

section "Taille du journal système"
journalctl --disk-usage 2>/dev/null || true

section "Vol de CPU (steal time, VPS partagé)"
echo "Colonne 'st' : si > 10 %, l'hébergeur surcharge la machine physique."
vmstat 1 5
