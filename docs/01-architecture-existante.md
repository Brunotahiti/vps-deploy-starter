# 01 — Analyse de l'existant

## Ce que contenait le dépôt avant ManaResto

Le dépôt `vps-deploy-starter` était un **template de déploiement**, sans aucun code applicatif :

| Fichier | Rôle |
|---|---|
| `docker-compose.yml` | Service `app` unique derrière Traefik (labels HTTPS Let's Encrypt, en-têtes de sécurité HSTS / nosniff / X-Frame-Options). Placeholders `__APP_NAME__`, `__PUBLIC_HOST__`, `__APP_PORT__`. |
| `Dockerfile.next` / `.node` / `.python` / `.static` | Quatre Dockerfiles au choix ; `Dockerfile.next` = build Next.js standalone multi-étapes sur Node 22 Alpine (pnpm/yarn/npm détectés par lockfile). |
| `compose-postgres-snippet.yml` | Service Postgres 16 alpine sur réseau interne, healthcheck, volume nommé. |
| `init.sh` | Assistant interactif de substitution des placeholders et sélection du Dockerfile. |
| `scripts/db-backup.sh`, `db-restore.sh` | Dump `pg_dump | gzip` avec rétention 14 jours, restauration interactive. |
| `scripts/setup-ci.sh`, `sync-to-vps.sh` | Clé SSH dédiée + secrets GitHub, rsync manuel de secours. |
| `.github/workflows/deploy.yml` | Au push sur `main` : rsync vers le VPS, `docker compose build && up -d`, vérification HTTP. |
| `.env.vps.example` | Variables d'environnement de production. |

Aucun framework, aucune base de données, aucun modèle métier n'était présent. Les technologies **déjà choisies** par le starter (Docker, Traefik, Postgres 16, Node 22, Next.js standalone, GitHub Actions → VPS Hostinger) sont pertinentes pour ManaResto et ont été **conservées**.

## Décisions prises

- **Conservé** : `Dockerfile.next` (renommé `Dockerfile`, adapté à Prisma), `docker-compose.yml` (placeholders remplacés par des variables `.env`, ajout du service `db` et d'un service `migrate`), scripts de sauvegarde/restauration, workflow GitHub Actions.
- **Supprimé** : `init.sh`, les Dockerfiles Node/Python/Static et le snippet Postgres (devenus inutiles : le projet n'est plus un template générique).
- **Ajouté** : l'application ManaResto complète (voir `02-architecture-cible.md`).
