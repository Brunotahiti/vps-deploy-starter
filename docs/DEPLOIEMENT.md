# Déploiement sur le VPS Hostinger

## En une commande, depuis le Mac

```bash
cd manaresto && bash scripts/deploy-vps.sh
```

Le script demande deux choses : le **nom de domaine** (ex. `manaresto.pf`, ou le nom fourni par Hostinger du type `srv1565699.hstgr.cloud`) et s'il faut charger la **démo**. Il fait ensuite tout le reste :

1. crée une clé SSH dédiée et la copie sur le VPS (mot de passe root demandé une seule fois) ;
2. envoie le code dans `/opt/manaresto` (rsync) ;
3. **vérifie** que Docker, le réseau `traefik` et le Traefik du serveur sont présents, sans rien modifier (ManaResto ne démarre ni ne reconfigure jamais Traefik : il se branche sur celui qui existe) ;
4. crée le fichier `.env` de production avec des mots de passe **générés** (jamais écrasés ensuite) ;
5. construit les images et démarre : PostgreSQL → migrations (+ démo) → application ;
6. programme la **sauvegarde quotidienne** à 3 h (`scripts/db-backup.sh`, rétention 14 jours) ;
7. vérifie `https://<domaine>/api/health`.

Relancer la même commande met à jour l'application (le `.env` et la base sont conservés).

### Avant de lancer

- Le domaine doit pointer vers l'IP du VPS (enregistrement DNS **A** → `187.127.105.242`). Le nom `srv1565699.hstgr.cloud` est déjà utilisé par un autre site du serveur : ManaResto a son propre sous-domaine, **`manaresto.manaprocess.cloud`**.
- La zone DNS de `manaprocess.cloud` est gérée chez **Cloudflare** (serveurs `lex`/`meg.ns.cloudflare.com`), pas dans le panneau Hostinger : un enregistrement créé chez Hostinger n'a aucun effet. Ajouter l'enregistrement A dans Cloudflare, proxy activé (nuage orange) comme les autres sous-domaines. Vérifier : `dig +short @1.1.1.1 manaresto.manaprocess.cloud` doit répondre (adresses Cloudflare avec le proxy).
- Le VPS doit déjà avoir Docker et **son Traefik** (réseau Docker `traefik`, entrypoints `web` / `websecure`, certresolver `letsencrypt`), comme fourni par le starter. Le script s'arrête avec un message clair si l'un des trois manque et ne touche pas au pare-feu.
- VPS visé par défaut : `root@187.127.105.242` (modifiable : `VPS_HOST=... VPS_USER=... bash scripts/deploy-vps.sh`).

## Déploiement automatique à chaque `git push` (facultatif)

Une fois, sur le Mac :

```bash
brew install gh && gh auth login
bash scripts/setup-ci.sh
```

Le script enregistre la clé SSH et les secrets GitHub (`VPS_SSH_KEY`, `VPS_HOST`, `VPS_USER`, `VPS_PATH`, `PUBLIC_HOST`). Ensuite chaque push sur `main` déclenche `.github/workflows/deploy.yml` (rsync + rebuild + redémarrage). Tant que les secrets manquent, ce workflow s'ignore proprement.

## Exploitation

| Besoin | Commande (depuis le Mac) |
|---|---|
| Journaux de l'application | `ssh -i ~/.ssh/manaresto_vps root@187.127.105.242 'cd /opt/manaresto && docker compose logs -f app'` |
| État des conteneurs | `… 'cd /opt/manaresto && docker compose ps'` |
| Sauvegarde immédiate | `… '/opt/manaresto/scripts/db-backup.sh'` |
| Restaurer une sauvegarde | `… 'bash /opt/manaresto/scripts/db-restore.sh /var/backups/manaresto/<fichier>.sql.gz'` |
| Sauvegardes chiffrées | ajouter `BACKUP_PASSPHRASE=…` dans `/opt/manaresto/.env` (AES-256, déchiffrement automatique à la restauration) |
| Certificat HTTPS absent (Cloudflare répond 526) | Traefik ne demande le certificat qu'à la mise en place du routeur ; si le DNS n'existait pas encore à ce moment, la demande a échoué et n'est pas réessayée. Mettre le DNS en place **avant** le premier déploiement. Sinon, Traefik refait toutes les demandes manquantes à son redémarrage : `docker restart traefik` (coupure d'environ une seconde pour tous les sites, configuration et certificats existants intacts), puis vérifier `docker exec traefik grep -c manaresto.manaprocess.cloud /letsencrypt/acme.json` (≥ 1). |
| Désactiver la démo | mettre `SEED_DEMO=false` dans `/opt/manaresto/.env` (la démo déjà chargée reste en base ; supprimer l'entreprise « demo-mana-beach » si besoin) |

## Reçus par e-mail (SMTP)

Pour envoyer les reçus PDF aux clients, ajouter dans `/opt/manaresto/.env` (sur le VPS) puis relancer `docker compose up -d app` :

```
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=contact@votre-restaurant.pf
SMTP_PASS=le-mot-de-passe-de-la-boite
SMTP_FROM="Le Mana Beach <contact@votre-restaurant.pf>"
```

Avec une boîte e-mail Hostinger, ce sont les réglages standard. Tout autre serveur SMTP (Gmail avec mot de passe d'application, OVH, Brevo…) fonctionne de la même façon. L'état apparaît dans *Administration → Paramètres → Reçus par e-mail*.

## Site vitrine et domaine manaresto.com

Le site de présentation (`site/`, pages statiques) est servi par un petit conteneur nginx à côté de l'application, avec HTTPS par Traefik. Domaines par défaut : **www.manaresto.com** (le nom nu `manaresto.com` redirige vers www) pour le site, **app.manaresto.com** pour l'application. Les boutons « Créer mon compte gratuit » du site ouvrent `https://app.manaresto.com/signup`.

DNS chez Hostinger pour `manaresto.com` (enregistrements A vers l'IP du VPS, sans proxy) :

| Type | Nom | Valeur |
|---|---|---|
| A | `@` | 187.127.105.242 |
| A | `www` | 187.127.105.242 |
| A | `app` | 187.127.105.242 |

Puis, depuis votre Mac : `bash scripts/deploy-vps.sh` en répondant `app.manaresto.com` au domaine de l'application. L'ancien domaine reste accepté si `PUBLIC_HOST_ALT=manaresto.manaprocess.cloud` est présent dans `/opt/manaresto/.env` ; les domaines du site se règlent avec `SITE_HOST` et `SITE_HOST_ALT`. Traefik demande les certificats automatiquement une fois le DNS en place (comptez quelques minutes). Pour changer l'adresse de l'application utilisée par le site, modifiez `data-app` dans `site/index.html`.

## Sécurité en production

- Changer le mot de passe du compte propriétaire de démo, ou créer votre entreprise via `/signup` et ne pas charger la démo.
- Le `.env` du VPS contient les secrets : ne jamais le committer ni le copier ailleurs.
- HTTPS forcé par Traefik, en-têtes de sécurité, cookies `Secure`, base non exposée (réseau interne Docker).
