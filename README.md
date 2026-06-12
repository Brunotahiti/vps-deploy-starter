# 🚀 VPS Deploy Starter

Template clé-en-main pour déployer n'importe quel projet sur **VPS Hostinger + Docker + Traefik** via **GitHub Actions** (auto-deploy au `git push`).

## ⚡ Utilisation

### 1. Créer un nouveau repo depuis ce template

**Sur GitHub** : clique sur **Use this template → Create a new repository**
ou en CLI :

```bash
gh repo create mon-nouveau-projet --template Brunotahiti/vps-deploy-starter --private --clone
cd mon-nouveau-projet
```

### 2. Lancer l'initialisation interactive

```bash
bash init.sh
```

Le script te demande :
- **Nom du projet** (kebab-case, ex: `mon-projet`)
- **Domaine ou sous-domaine** (ex: `monprojet.pf` ou `srv1565699.hstgr.cloud`)
- **Port interne** de l'app (3000 par défaut)
- **Framework** (next / node / python / static)
- **Postgres ?** (ajoute un container Postgres 16 + scripts backup/restore)

Il génère/adapte automatiquement tous les fichiers.

### 🗄️ Si tu choisis Postgres

- Service `db` (Postgres 16-alpine) ajouté au `docker-compose.yml`
- Réseau interne dédié (la DB n'est pas exposée publiquement)
- Mot de passe aléatoire généré (`POSTGRES_PASSWORD` dans `.env`)
- Variable `DATABASE_URL` pré-remplie
- Scripts `db-backup.sh` (gzip + rétention 14 jours) et `db-restore.sh`
- Volume Docker nommé pour la persistance

Active la sauvegarde quotidienne sur le VPS :
```bash
crontab -e
# Ajouter :
0 3 * * * /opt/MON_PROJET/scripts/db-backup.sh
```

### 3. Coder ton app

Mets ton code dans le projet (le `Dockerfile` est déjà adapté au framework choisi).

### 4. Configurer la clé SSH + secrets GitHub (UNE FOIS)

```bash
bash scripts/setup-ci.sh
```

Le script génère une clé SSH dédiée, la copie sur le VPS, et configure les 5 secrets GitHub :
`VPS_SSH_KEY`, `VPS_HOST`, `VPS_USER`, `VPS_PATH`, `PUBLIC_HOST`.

### 5. Premier push → premier déploiement

```bash
git add -A
git commit -m "Initial deploy"
git push
gh run watch
```

→ ~2-3 minutes plus tard, ton app est live sur HTTPS avec certificat Let's Encrypt auto.

---

## 🔄 Workflow définitif

```bash
git add -A && git commit -m "fix: ..." && git push
# ✨ GitHub Actions déploie tout seul
```

Ou déclenche manuellement depuis GitHub Web / Mobile :
**Actions → Deploy to VPS → Run workflow**.

---

## 🛠️ Pré-requis VPS (déjà fait sur srv1565699.hstgr.cloud)

- Ubuntu 24.04
- Docker + Docker Compose
- Traefik en container avec :
  - Réseau Docker externe `traefik`
  - Certresolver Let's Encrypt configuré (`letsencrypt`)
  - Entrypoints `web` (80) et `websecure` (443)

Si tu utilises un autre VPS, change `VPS_HOST` dans `init.sh` ou en variable d'env.

---

## 📂 Structure générée

```
.
├── .github/workflows/deploy.yml    # Auto-deploy au push
├── .dockerignore
├── Dockerfile                       # Adapté au framework choisi
├── docker-compose.yml               # Labels Traefik HTTPS auto
├── .env.vps.example                 # Template variables d'env
├── scripts/
│   ├── setup-ci.sh                  # Configure SSH + GitHub secrets (1x)
│   └── sync-to-vps.sh               # Push manuel de fallback
└── init.sh                          # Initialisation interactive
```

---

## 🔐 Sécurité

- HTTPS forcé (HSTS preload, X-Frame-Options DENY, Referrer-Policy strict)
- Container en `restart: unless-stopped`
- Aucun secret dans le code (toujours dans `.env` sur le VPS, jamais commité)
- GitHub Actions : SSH key dédiée par projet, scope limité

---

## 📜 Licence

MIT.
