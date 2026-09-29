# ManaResto — La gestion complète de votre restaurant

Caisse (POS) et back-office SaaS/PWA pour les restaurants, snacks, roulottes, bars et hôtels de **Polynésie française** : F CFP sans décimales, TVA configurable, N° Tahiti, mode hors ligne, multi-établissements.

> État : **toutes les phases livrées (1 à 8)** — socle, caisse, cuisine, stock, personnel et rapports, digital, avancé (multi-sites, export comptable, API publique, webhooks, TPE, imprimantes, Redis), consolidation. Voir `docs/ROADMAP.md`, `docs/GUIDE-UTILISATEUR.md` et `docs/API-PUBLIQUE.md`.

## Démarrage sur Mac en une commande

```bash
git clone https://github.com/Brunotahiti/vps-deploy-starter.git manaresto && cd manaresto && bash scripts/dev-mac.sh
```

Le script installe ce qui manque (Homebrew, Node 22, PostgreSQL 16 via Docker Desktop s'il est présent, sinon via Homebrew), crée `.env`, installe les dépendances, applique le schéma, charge la démo et lance http://localhost:3000. Pour tester la PWA et le mode hors ligne (service worker), utilisez le build de production : `pnpm build && pnpm start`.

## Démarrage local pas à pas

```bash
pnpm install                    # génère aussi le client Prisma (postinstall)
cp .env.example .env            # DATABASE_URL, SESSION_SECRET
pnpm db:migrate                 # crée le schéma (prisma migrate dev)
pnpm db:seed                    # restaurant de démonstration « Le Mana Beach »
pnpm dev                        # http://localhost:3000
```

Les produits de démonstration ont des illustrations locales (`public/demo/*.svg`) ; remplacez-les par vos photos via le champ « URL photo » d'un produit.

Reçus : impression 80 mm, **reçu PDF élégant (A5)** téléchargeable ou **envoyé par e-mail au client** (après paiement ou depuis l'historique) dès que les variables `SMTP_*` sont renseignées (`.env`).

Comptes de démonstration (mot de passe `demo1234`) :

| Rôle | Email | PIN caisse |
|---|---|---|
| Propriétaire | demo@manaresto.pf | 1234 |
| Manager | manager@manaresto.pf | 2000 |
| Serveurs | moana@ / vaiana@ / tamatoa@ / poema@ / heimana@manaresto.pf | 1001 … 1005 |
| Cuisine / Bar / Comptable | cuisine@ / bar@ / compta@manaresto.pf | 3000 / 4000 / 5000 |

Pour la **connexion par PIN** : un manager enregistre l'appareil dans *Administration → Paramètres → Terminaux*, puis l'écran `/pos/login` accepte les PIN du personnel.

## Application web installable (PWA) et mode hors ligne

- Ouvrir l'URL dans Chrome / Edge / Safari sur tablette, puis **Installer** (bouton dans la caisse) ou, sur iPad, Partager → *Sur l'écran d'accueil*. L'application se lance ensuite en plein écran.
- Sans réseau, la caisse continue : ouverture de table, ajout d'articles, envoi cuisine, encaissement. Les opérations sont mises en file d'attente (IndexedDB) avec des identifiants UUID et des clés d'idempotence, puis rejouées automatiquement à la reconnexion sans doublon. L'indicateur EN LIGNE / HORS LIGNE et le nombre d'opérations « à synchroniser » sont affichés en permanence.
- Le service worker n'est actif qu'en build de production (`pnpm build && pnpm start`).

## Scripts

| Commande | Rôle |
|---|---|
| `pnpm typecheck` / `pnpm lint` | TypeScript strict / ESLint |
| `pnpm test` | Vitest : unitaires (TVA, monnaie, partage, totaux, permissions) + intégration (base `manaresto_test`) |
| `pnpm test:e2e` | Playwright contre un serveur démarré (`E2E_BASE_URL`, défaut :3100) |
| `pnpm build` / `pnpm start` | Build production standalone |
| `pnpm db:deploy` | `prisma migrate deploy` (production) |

## Déploiement VPS (Hostinger, Docker + Traefik)

En une commande depuis le Mac (Docker, Traefik HTTPS, `.env` généré, migrations, démo, sauvegarde quotidienne) :

```bash
bash scripts/deploy-vps.sh
```

Détails, déploiement automatique à chaque `git push` et exploitation : `docs/DEPLOIEMENT.md`.

## Documentation

- `docs/01-architecture-existante.md` — analyse du starter d'origine
- `docs/02-architecture-cible.md` — stack, organisation, multi-tenant, flux caisse, sécurité
- `docs/03-modele-de-donnees.md` — tables et règles de calcul
- `docs/API.md` — routes REST et permissions
- `docs/ROADMAP.md` — phases 1 à 8 et leur état
- `docs/GUIDE-UTILISATEUR.md` — guide d'utilisation par module
- `docs/API-PUBLIQUE.md` — API v1, webhooks, TPE, impression
- `docs/DEPLOIEMENT.md` — mise en ligne sur le VPS Hostinger
