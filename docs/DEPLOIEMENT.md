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

Le script enregistre la clé SSH et les secrets GitHub (`VPS_SSH_KEY`, `VPS_HOST`, `VPS_USER`, `VPS_PATH`, `PUBLIC_HOST`). Ensuite chaque push sur `main` déclenche `.github/workflows/deploy.yml` :

1. **tests** (typage, lint, tests automatiques, construction) : si l'un échoue, rien n'est envoyé sur le serveur ;
2. envoi du code, sauvegarde de la base, conservation de la version en service (étiquette `previous`), reconstruction et redémarrage ;
3. vérification que `https://PUBLIC_HOST/api/health` répond ; sinon **retour automatique à la version précédente** (les migrations ne faisant qu'ajouter, l'ancienne version fonctionne avec la base à jour) et déploiement marqué en échec.

Tant que les secrets manquent, ce workflow s'ignore proprement.

## Exploitation

| Besoin | Commande (depuis le Mac) |
|---|---|
| Journaux de l'application | `ssh -i ~/.ssh/manaresto_vps root@187.127.105.242 'cd /opt/manaresto && docker compose logs -f app'` |
| État des conteneurs | `… 'cd /opt/manaresto && docker compose ps'` |
| Sauvegarde immédiate | `… '/opt/manaresto/scripts/db-backup.sh'` |
| Restaurer une sauvegarde | `… 'bash /opt/manaresto/scripts/db-restore.sh /var/backups/manaresto/<fichier>.sql.gz'` : l'archive est vérifiée avant toute modification, une sauvegarde de sécurité est faite, l'application est arrêtée pendant l'opération, et la restauration se fait en une seule transaction (en cas d'erreur, la base reste dans son état précédent). Confirmation en tapant « restaurer ». |
| Copie des sauvegardes hors du serveur | Une fois, sur le serveur : `bash /opt/manaresto/scripts/backup-remote-setup.sh` (assistant rclone dans Docker : Backblaze B2, Cloudflare R2, Scaleway, OVH, Google Drive…). Puis dans `/opt/manaresto/.env` : `BACKUP_REMOTE=<stockage>:<dossier>` et `BACKUP_PASSPHRASE=…` (obligatoire : les sauvegardes ne quittent le serveur que chiffrées ; gardez la phrase ailleurs, sans elle rien n'est restaurable). Chaque sauvegarde quotidienne est alors copiée, conservée 90 jours à distance (`REMOTE_RETENTION_DAYS`). |
| Copie des sauvegardes sur le Mac | `bash scripts/backup-pull-mac.sh` : rapatrie les sauvegardes dans `~/ManaResto-sauvegardes` (deuxième copie gratuite, rien n'est supprimé sur le Mac). |
| Sauvegardes chiffrées | ajouter `BACKUP_PASSPHRASE=…` dans `/opt/manaresto/.env` (AES-256, déchiffrement automatique à la restauration) |
| Certificat HTTPS absent (Cloudflare répond 526) | Traefik ne demande le certificat qu'à la mise en place du routeur ; si le DNS n'existait pas encore à ce moment, la demande a échoué et n'est pas réessayée. Mettre le DNS en place **avant** le premier déploiement. Sinon, Traefik refait toutes les demandes manquantes à son redémarrage : `docker restart traefik` (coupure d'environ une seconde pour tous les sites, configuration et certificats existants intacts), puis vérifier `docker exec traefik grep -c manaresto.manaprocess.cloud /letsencrypt/acme.json` (≥ 1). |
| Limites de mémoire | Chaque conteneur a sa limite (application 768 Mo, base 512 Mo, site 64 Mo, migrations/démo 512 Mo le temps de leur passage) et chaque programme est réglé pour tenir dedans : Node.js plafonne sa mémoire (`APP_HEAP_MB`, ≈ 2/3 de la limite), PostgreSQL ses caches et ses connexions (`DB_SHARED_BUFFERS`, `DB_WORK_MEM`, `DB_MAX_CONNECTIONS`…). À ajuster ensemble dans `/opt/manaresto/.env` (voir `.env.example`), puis redéployer. Un changement des réglages de la base la redémarre quelques secondes au déploiement suivant. |
| Serveur lent : diagnostic (lecture seule) | `ssh -i ~/.ssh/manaresto_vps root@187.127.105.242 'bash -s' < scripts/vps-diagnose.sh` : charge, mémoire et swap, disque, journaux Docker, conteneurs qui redémarrent, processus tués faute de mémoire |
| Serveur lent : libérer le disque | `… 'bash /opt/manaresto/scripts/vps-cleanup.sh'` : images orphelines, cache de construction de plus de 7 jours, journaux Docker de plus de 50 Mo, journal système limité à 200 Mo. Ne supprime aucun conteneur ni volume (autres sites, bases, certificats Traefik). Le cache de construction est déjà purgé à chaque déploiement. |
| Démo vivante | Avec `SEED_DEMO=true`, le compte de démonstration (demo@manaresto.pf) a 60 jours d'historique et son service du jour est renouvelé à chaque déploiement puis toutes les heures (tâche planifiée installée par le déploiement, journal `/var/log/manaresto-demo.log`) : ventes encaissées jusqu'à l'heure courante, tables en cours, tickets cuisine, commandes en ligne, réservations, pointages. Les commandes saisies par les visiteurs sont conservées, sauf si elles restent ouvertes d'un jour sur l'autre. Rafraîchir à la main : `… 'cd /opt/manaresto && docker compose run --rm --no-deps -T migrate pnpm tsx prisma/seed.ts'` ; recréer entièrement : ajouter `-e RESEED=1` après `run`. |
| Désactiver la démo | mettre `SEED_DEMO=false` dans `/opt/manaresto/.env` (la démo déjà chargée reste en base ; supprimer l'entreprise « demo-mana-beach » si besoin) |

## E-mails (Brevo, adresse contact@manaresto.com)

L'application envoie les reçus PDF, les invitations d'équipe, l'e-mail de **bienvenue** à l'inscription, le **rappel 3 jours avant la fin de l'essai**, l'e-mail **« essai expiré »** et les messages écrits depuis la console plateforme. Expéditeur recommandé : `contact@manaresto.com` via le relais SMTP de **Brevo**.

1. Dans Brevo : *Expéditeurs, domaines et IP dédiées → Domaines* → ajouter `manaresto.com`, puis copier dans la zone DNS (Cloudflare) les enregistrements proposés : **TXT brevo-code**, **DKIM** (CNAME ou TXT) et **DMARC** (TXT `_dmarc`). Attendre la validation (coches vertes).
2. Dans Brevo : *Expéditeurs* → ajouter `contact@manaresto.com` (nom affiché « ManaResto »).
3. Dans Brevo : *Paramètres → SMTP & API → SMTP* → noter l'**identifiant SMTP** et générer une **clé SMTP**.
4. Sur le VPS, ajouter dans `/opt/manaresto/.env` puis relancer `docker compose up -d app` (ou redéployer) :

```
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=identifiant-smtp-brevo
SMTP_PASS=cle-smtp-brevo
SMTP_FROM="ManaResto <contact@manaresto.com>"
```

Les réponses des restaurateurs arrivent sur `contact@manaresto.com` (en-tête « Répondre à »). La boîte de réception elle-même reste celle de votre hébergeur de messagerie (enregistrements MX inchangés). L'état apparaît dans *Administration → Paramètres → Reçus par e-mail* et en haut de la console plateforme.

## Notifications push « plat prêt »

Les serveurs peuvent recevoir une notification sur leur téléphone quand la cuisine passe un plat à « Prêt » (norme Web Push, aucun service tiers). Le serveur a besoin d'une paire de clés **VAPID** dans `/opt/manaresto/.env` :

```
VAPID_PUBLIC_KEY=…
VAPID_PRIVATE_KEY=…
VAPID_SUBJECT=mailto:contact@manaresto.com
```

`scripts/deploy-vps.sh` les génère automatiquement (openssl, courbe P-256) si le `.env` du VPS n'en a pas, puis redémarre l'application. À la main : `pnpm push:keys` (web-push) et copier les deux clés. **Ne changez pas les clés ensuite** : tous les appareils devraient se réabonner. Sans clés, le bouton « Alertes plat prêt » n'apparaît pas et tout le reste fonctionne normalement. Les notifications passent par le service push du navigateur (Apple, Google, Mozilla) et ne contiennent que la table et les plats à apporter.

## Assistant IA (Claude)

L'option **Assistant IA** propose les prévisions de fréquentation (façon Bison Futé), la commande d'achats proposée, les **conseils de la semaine** et l'**analyse qualité inspirée de l'ISO 9001**. Les prévisions et la commande sont calculées par le programme ; les conseils et l'analyse qualité sont rédigés par **Claude** (Anthropic), à partir des seuls chiffres du restaurant.

1. Créer un compte sur [console.anthropic.com](https://console.anthropic.com), ajouter un moyen de paiement (facturation à l'usage : quelques centimes par analyse) et créer une **clé API**.
2. Sur le VPS, ajouter dans `/opt/manaresto/.env` puis redéployer :

```
ANTHROPIC_API_KEY=sk-ant-...
```

Limites : 3 analyses qualité et 5 demandes de conseils par jour et par établissement. Les analyses sont gardées (table `ai_reports`) et restent consultables sans nouvel appel.

## Console plateforme (/platform)

Vue d'ensemble de tous les restaurants inscrits, réservée à l'équipe ManaResto : revenu mensuel, inscriptions, essais en cours et expirés, abonnés, restaurants actifs, parcours inscription → abonnement, dernières connexions, demandes de démonstration du site. Pour chaque restaurant : propriétaire, statut, fin d'essai ou de période, temps d'utilisation sur 7 et 30 jours, dernier e-mail, page publique, et les actions **Prendre la main** (ouvrir l'application comme le restaurateur, bandeau violet pour revenir), **E-mail**, **Bloquer / Débloquer** et **Statut** (prolonger l'essai, activer l'abonnement 12 mois, suspendre).

Accès : ajouter dans `/opt/manaresto/.env` l'adresse du compte ManaResto avec lequel vous vous connectez, puis redéployer ; le lien « Console ManaResto » apparaît dans le menu de l'administration.

```
PLATFORM_ADMIN_EMAILS=contact@manaresto.com
```

**Alertes à l'équipe** : un e-mail part à chaque nouvelle inscription et à chaque demande de démonstration du site, vers `contact@manaresto.com` par défaut. Pour choisir les destinataires : `PLATFORM_NOTIFY_EMAILS=contact@manaresto.com,vous@icloud.com bash scripts/deploy-vps.sh`.

Les relances automatiques (rappel J-3 et essai expiré) partent toutes les heures, une seule fois par restaurant ; le bouton « Lancer les relances » de la console les déclenche tout de suite. `LIFECYCLE_EMAILS=off` les désactive.

## Site vitrine et domaine manaresto.com

Le site de présentation (`site/`, pages statiques) est servi par un petit conteneur nginx à côté de l'application, avec HTTPS par Traefik. Domaines par défaut : **www.manaresto.com** (le nom nu `manaresto.com` redirige vers www) pour le site, **app.manaresto.com** pour l'application. Les boutons « Créer mon compte gratuit » du site ouvrent `https://app.manaresto.com/signup`.

DNS chez Hostinger pour `manaresto.com` : modifiez l'enregistrement A `@` existant (il pointe sur la page de parking Hostinger) au lieu d'en ajouter un second, gardez le CNAME `www`, ajoutez `app` :

| Type | Nom | Valeur |
|---|---|---|
| A | `@` | 187.127.105.242 |
| CNAME | `www` | manaresto.com (déjà présent chez Hostinger, à conserver) |
| A | `app` | 187.127.105.242 |

Le formulaire « Demander une démonstration » du site est relayé par nginx (`site/nginx/default.conf`, `location /api/demo`) vers l'application (`/api/public/demo-request`) : les demandes sont enregistrées dans la table `demo_requests` et envoyées par e-mail à `contact@manaresto.com` si le SMTP est configuré. Les informations légales et commerciales du site se règlent dans `site/config.js` ; la bannière « Iaorana et Maeva » et le logo officiel sont à déposer dans `site/assets/img/banner-iaorana.jpg` et `site/assets/img/logo.png` (affichés automatiquement s'ils existent).

Puis, depuis votre Mac : `bash scripts/deploy-vps.sh` en répondant `app.manaresto.com` au domaine de l'application. L'ancien domaine reste accepté si `PUBLIC_HOST_ALT=manaresto.manaprocess.cloud` est présent dans `/opt/manaresto/.env` ; les domaines du site se règlent avec `SITE_HOST` et `SITE_HOST_ALT`. Traefik demande les certificats automatiquement une fois le DNS en place (comptez quelques minutes). Pour changer l'adresse de l'application utilisée par le site, modifiez `data-app` dans `site/index.html`.

## Référencement Google (Search Console)

1. Ouvrez https://search.google.com/search-console, « Ajouter une propriété » → type **Domaine** → `manaresto.com`.
2. Google fournit un enregistrement **TXT** (`google-site-verification=…`) : ajoutez-le chez Hostinger (DNS, type TXT, nom `@`), puis cliquez sur « Vérifier » (quelques minutes de propagation).
3. Dans Search Console → Sitemaps, soumettez `https://www.manaresto.com/sitemap.xml` ; dans Inspection d'URL, demandez l'indexation de `https://www.manaresto.com/`.
4. Facultatif mais utile localement : créez une fiche **Google Business Profile** « ManaResto » (catégorie éditeur de logiciels, Tahiti) pointant vers le site, et faites la même déclaration sur Bing Webmaster Tools (import direct depuis Search Console).

Le site expose déjà `robots.txt`, `sitemap.xml`, la balise canonique, les données structurées (Organization, SoftwareApplication, FAQPage) et les balises Open Graph.

## Suivi des erreurs (Sentry)

L'application embarque le SDK Sentry (navigateur, serveur et edge). Il ne s'active que si `SENTRY_DSN` est renseignée dans `/opt/manaresto/.env` :

1. Dans Sentry (organisation `manaprocess-rd`), créez un projet **Next.js** nommé `manaresto` puis copiez sa DSN (Settings → Projects → manaresto → Client Keys).
2. Ajoutez `SENTRY_DSN=…` (et éventuellement `SENTRY_ENVIRONMENT=production`) au `.env` du VPS.
3. Relancez `bash scripts/deploy-vps.sh` : la DSN est intégrée au build pour le navigateur et lue au démarrage par le serveur.

Les erreurs des routes API non gérées, les erreurs de rendu serveur et les plantages de l'interface sont remontés avec la version (`manaresto@<commit>`). Les coupures réseau (mode hors ligne de la caisse) sont ignorées. Les envois passent par `/monitoring` pour contourner les bloqueurs de publicité. Pour des traces lisibles, fournissez `SENTRY_AUTH_TOKEN` (scope `project:releases`) : les source maps sont alors téléversées au build.

## Abonnements (offre commerciale)

Chaque entreprise créée via `/signup` démarre avec **15 jours d'essai gratuits** (toutes fonctions, sans carte bancaire) ; l'offre est ensuite de 12 000 F CFP par mois avec un engagement de 12 mois et 0 % de commission (`src/lib/plan.ts`). Un bandeau dans l'administration indique les jours restants ; à l'échéance l'application continue de fonctionner mais signale l'essai terminé, et la page Paramètres → Abonnement propose de vous contacter.

Activer, suspendre ou prolonger l'essai d'une entreprise : depuis la console plateforme (`/platform`, bouton **Statut**), ou sur le VPS :

```
cd /opt/manaresto
bash scripts/plan.sh <slug-entreprise> ACTIVE        # abonnement actif
bash scripts/plan.sh <slug-entreprise> SUSPENDED     # suspendu
bash scripts/plan.sh <slug-entreprise> TRIAL 30      # nouvel essai de 30 jours
```

Le slug figure dans l'URL des pages publiques de l'entreprise (`/commander/<slug>/…`) et dans la table `organizations`.

## Boîtier de secours (mini-PC du restaurant)

Le boîtier prend le relais des tablettes quand internet coupe (voir `tools/box-gateway/README.md`). Côté serveur, une seule chose à régler pour l'adresse HTTPS des boîtiers (indispensable pour la connexion par PIN hors ligne et l'installation de l'application sur les tablettes) :

1. Chez Cloudflare (zone `manaresto.com`) : créer un jeton API avec le droit **Zone → DNS → Modifier** limité à cette zone, et noter l'identifiant de zone (page d'accueil de la zone, colonne de droite).
2. Dans le `.env` du VPS : `BOX_DNS_ZONE=box.manaresto.com`, `CLOUDFLARE_ZONE_ID=…`, `CLOUDFLARE_API_TOKEN=…`, `ACME_EMAIL=contact@manaresto.com`, puis redéployer.

Chaque boîtier reçoit alors l'adresse `<8 caractères>.box.manaresto.com`, qui pointe vers son adresse sur le réseau du restaurant, avec un certificat Let's Encrypt (défi DNS : rien à ouvrir chez le restaurateur). Le compte Let's Encrypt est créé une fois et gardé en base (`platform_secrets`).

Installation chez un restaurateur : Admin → Imprimantes & tiroir → **Boîtier de secours → Ajouter un boîtier**, puis la commande affichée sur le mini-PC (Ubuntu ou Debian, Intel/AMD, branché par câble sur la box). Le boîtier télécharge la version de l'application depuis le serveur (`/api/box/release`, avec sa clé) et se met à jour tout seul après chaque déploiement.

Certaines box internet bloquent les noms qui pointent vers une adresse locale (« protection contre le DNS rebinding ») : si les tablettes ne trouvent pas l'adresse du boîtier, autoriser `box.manaresto.com` dans les réglages DNS de la box.

## Sécurité en production

- Changer le mot de passe du compte propriétaire de démo, ou créer votre entreprise via `/signup` et ne pas charger la démo.
- Le `.env` du VPS contient les secrets : ne jamais le committer ni le copier ailleurs.
- HTTPS forcé par Traefik, en-têtes de sécurité, cookies `Secure`, base non exposée (réseau interne Docker).
