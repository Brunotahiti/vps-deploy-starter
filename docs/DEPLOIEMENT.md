# Déploiement sur le VPS Hostinger

## En une commande, depuis le Mac

```bash
cd manaresto && bash scripts/deploy-vps.sh
```

Le script demande trois choses : le **nom de domaine** (ex. `manaresto.pf`, ou le nom fourni par Hostinger du type `srv1565699.hstgr.cloud`), un **email** pour les certificats HTTPS Let's Encrypt, et s'il faut charger la **démo**. Il fait ensuite tout le reste :

1. crée une clé SSH dédiée et la copie sur le VPS (mot de passe root demandé une seule fois) ;
2. envoie le code dans `/opt/manaresto` (rsync) ;
3. installe Docker si besoin, crée le réseau `traefik` et démarre **Traefik v3** (HTTPS automatique) s'il n'est pas déjà là ;
4. crée le fichier `.env` de production avec des mots de passe **générés** (jamais écrasés ensuite) ;
5. construit les images et démarre : PostgreSQL → migrations (+ démo) → application ;
6. programme la **sauvegarde quotidienne** à 3 h (`scripts/db-backup.sh`, rétention 14 jours) ;
7. vérifie `https://<domaine>/api/health`.

Relancer la même commande met à jour l'application (le `.env` et la base sont conservés).

### Avant de lancer

- Le domaine doit pointer vers l'IP du VPS (enregistrement DNS **A** → `187.127.105.242`). Avec le nom `*.hstgr.cloud` fourni par Hostinger, rien à faire.
- Les ports 80 et 443 du VPS doivent être ouverts (le script règle UFW s'il est présent ; vérifier aussi le pare-feu du panneau Hostinger).
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

## Sécurité en production

- Changer le mot de passe du compte propriétaire de démo, ou créer votre entreprise via `/signup` et ne pas charger la démo.
- Le `.env` du VPS contient les secrets : ne jamais le committer ni le copier ailleurs.
- HTTPS forcé par Traefik, en-têtes de sécurité, cookies `Secure`, base non exposée (réseau interne Docker).
