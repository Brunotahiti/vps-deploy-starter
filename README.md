# ManaResto — La gestion complète de votre restaurant

Caisse (POS) et back-office SaaS/PWA pour les restaurants, snacks, roulottes, bars et hôtels de **Polynésie française** : F CFP sans décimales, TVA configurable, N° Tahiti, mode hors ligne, multi-établissements.

> État : **Phase 1 (socle) et Phase 2 (caisse) livrées** — voir `docs/ROADMAP.md`. Les phases suivantes (KDS, stock, personnel, digital, avancé) sont annoncées dans l'interface, jamais simulées.

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

```bash
cp .env.vps.example .env        # sur le VPS : mots de passe, SESSION_SECRET, PUBLIC_HOST
docker compose build migrate app
docker compose up -d            # db → migrate (migrations + seed optionnel) → app
```

Le workflow GitHub Actions `deploy.yml` fait la même chose à chaque push sur `main` (voir `scripts/setup-ci.sh`). Sauvegardes : `scripts/db-backup.sh` (gzip, chiffrement AES si `BACKUP_PASSPHRASE`, rétention `RETENTION_DAYS`), restauration `scripts/db-restore.sh`.

## Documentation

- `docs/01-architecture-existante.md` — analyse du starter d'origine
- `docs/02-architecture-cible.md` — stack, organisation, multi-tenant, flux caisse, sécurité
- `docs/03-modele-de-donnees.md` — tables et règles de calcul
- `docs/API.md` — routes REST et permissions
- `docs/ROADMAP.md` — phases 1 à 7 et leur état
