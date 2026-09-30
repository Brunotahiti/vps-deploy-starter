#!/usr/bin/env bash
# Active, suspend ou remet en essai l'abonnement d'une entreprise (à lancer sur le VPS, dans /opt/manaresto).
#   bash scripts/plan.sh <slug-entreprise> ACTIVE|SUSPENDED|TRIAL [jours-d-essai]
set -euo pipefail
SLUG="${1:-}"; PLAN="${2:-}"; DAYS="${3:-15}"
if [ -z "$SLUG" ] || [ -z "$PLAN" ]; then echo "Usage : bash scripts/plan.sh <slug> ACTIVE|SUSPENDED|TRIAL [jours]"; exit 1; fi
case "$PLAN" in
  ACTIVE)    SQL="UPDATE organizations SET plan='ACTIVE', plan_started_at=now() WHERE slug='$SLUG'";;
  SUSPENDED) SQL="UPDATE organizations SET plan='SUSPENDED' WHERE slug='$SLUG'";;
  TRIAL)     SQL="UPDATE organizations SET plan='TRIAL', trial_ends_at=now() + interval '$DAYS days' WHERE slug='$SLUG'";;
  *) echo "Plan inconnu : $PLAN"; exit 1;;
esac
docker compose exec -T db psql -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-manaresto}" -c "$SQL"
docker compose exec -T db psql -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-manaresto}" -c "SELECT name, slug, plan, trial_ends_at, plan_started_at FROM organizations WHERE slug='$SLUG'"
