# 02 — Architecture cible ManaResto

## Stack

| Couche | Choix | Pourquoi |
|---|---|---|
| Frontend + API | **Next.js 16** (App Router, route handlers), React 19, TypeScript strict | Une seule application déployable en standalone ; SSR pour l'admin, client-side pour la caisse (PWA). |
| UI | **Tailwind CSS 4**, lucide-react | Design original « lagon / corail », mode clair et sombre (`data-theme`), gros boutons tactiles. |
| Données | **PostgreSQL 16** + **Prisma 7** (driver adapter `@prisma/adapter-pg`, client TypeScript généré sans moteur Rust) | Migrations versionnées, typage bout en bout. |
| Validation | **zod** (schémas dans `src/server/schemas.ts`) | Toute entrée API est validée côté serveur. |
| Temps réel | **Server-Sent Events** (`/api/realtime`) sur un bus en mémoire (`src/server/realtime/bus.ts`) | Un flux par établissement ; interface prête pour Redis pub/sub en multi-instance. Les écritures passent par l'API HTTP, donc SSE suffit (pas de WebSocket bidirectionnel nécessaire). |
| Hors ligne | Service Worker (`public/sw.js`) + **IndexedDB** (`idb`) : cache du catalogue / plan de salle, **file d'attente (outbox)** des mutations avec **clé d'idempotence** rejouée à la reconnexion | Aucune commande perdue si Internet tombe. |
| État client | TanStack Query (cache + invalidation par événements SSE) | Rafraîchissement ciblé, pas de polling agressif. |
| Auth | Sessions opaques en base (`sessions`), cookie httpOnly `mr_session`, hachage **scrypt** (mots de passe et PIN), cookie terminal longue durée `mr_terminal` | Connexion email/mot de passe pour l'admin, **PIN** sur les terminaux enregistrés pour le personnel. |
| RBAC | Rôles par entreprise (`roles`), permissions référencées (`permissions`, `role_permissions`), rattachement utilisateur ↔ établissement ↔ rôle (`user_establishments`) | Permissions granulaires, rôles système + personnalisés, **PIN manager** pour les opérations sensibles. |
| PDF / impression | pdfkit (tickets PDF), HTML 80 mm imprimable, générateur **ESC/POS** pur (`src/server/hardware/escpos.ts`) derrière une interface `HardwareAdapter` | Indépendance matérielle. |
| Tests | Vitest (unitaires + intégration sur base Postgres de test), Playwright (E2E) | |

## Organisation du code

```
prisma/schema.prisma        modèle de données (44 tables) + migrations
prisma/seed.ts              restaurant de démonstration « Le Mana Beach »
src/lib/                    logique pure et partagée (monnaie/TVA, totaux, partage, dates, permissions)
src/server/db.ts            client Prisma
src/server/auth/            mots de passe, sessions, contexte (requireAuth / requirePermission), autorisation PIN
src/server/services/        logique métier : auth, roles, establishments, users, catalog, floor, orders, payments, cash, reports
src/server/receipts/        tickets HTML / PDF / ESC-POS
src/server/hardware/        HardwareAdapter (imprimantes, TPE) + ESC/POS
src/server/realtime/        bus d'événements
src/server/idempotency.ts   rejeu idempotent (Idempotency-Key)
src/server/audit.ts         journal d'audit (écriture seule)
src/app/api/**              routes REST (validation zod → service → JSON { data } | { error })
src/app/(pos)               /pos : salle, commande, caisse, commandes, connexion PIN
src/app/admin/**            back-office
src/app/onboarding          assistant 15 étapes
src/components/pos          composants caisse (plan, ticket, modales produit/article/paiement/PIN)
src/components/admin        shell, tableau de bord, graphiques
src/lib/offline             IndexedDB, outbox, provider en ligne / hors ligne
public/sw.js                service worker
```

## Multi-tenant

Hiérarchie **Compte (utilisateur) → Entreprise (`organizations`) → Établissement (`establishments`) → Zones (`rooms`) → Caisses (`terminals`) → Utilisateurs**.

- Chaque requête résout un `AuthContext` (utilisateur, établissement courant, permissions). **Tous** les services reçoivent `establishmentId` et filtrent `where: { establishmentId }` ; les références croisées (catégorie, TVA, poste, groupe d'options, table, rôle) sont vérifiées dans le même établissement / la même entreprise.
- Le propriétaire (`users.is_owner`) accède à tous les établissements de son entreprise et bascule via `/api/auth/switch-establishment`.
- Les tests d'intégration `tests/integration/tenancy-auth.test.ts` vérifient l'isolation.

## Flux caisse (Phase 2)

1. **Plan de salle** (`GET /api/floor`) : tables + commande ouverte + statut visuel (libre / occupée / commande en cours / plats envoyés / addition demandée / réservée / à nettoyer) + durée d'occupation.
2. **Commande** (`POST /api/orders`, id UUID fourni par le client → idempotent) : services (APÉRITIFS / ENTRÉES / PLATS / DESSERTS configurables), couverts, affectation par client (`seat_number`).
3. **Articles** (`POST /api/orders/:id/items`) : produit / variante / options (min-max, obligatoire, gratuit/payant) ou **formule** (sections, suppléments, options par composant). Prix, TVA et coût sont **figés** sur la ligne (snapshot).
4. **Envoi cuisine** (`POST /api/orders/:id/send`) : par service ou tout ; crée des `kitchen_tickets` **par poste** (routage produit → poste) ; statuts de service : à suivre / ne pas envoyer (HOLD) / faire marcher (FIRE, urgent) / servi.
5. **Écran cuisine (Phase 3, `/kds`)** : `src/server/services/kitchen.ts` — cycle NEW → ACCEPTED → IN_PROGRESS → READY → DONE (rappel DONE → READY), coche article par article ; chaque changement met à jour les `order_items` (SENT / PREPARING / READY / SERVED), le service (READY / SERVED) et publie `kitchen.updated` + `order.updated` + `table.updated`. Le plan de salle expose `readyCount` (plats prêts non servis). Alertes de temps selon `kitchen_stations.warn_after_sec / alert_after_sec`. Bon cuisine HTML / ESC-POS via `src/server/receipts/kitchen-ticket.ts`. Un ticket dont tous les articles sont annulés passe CANCELLED ; l'annulation ou le paiement de la commande clôt ses tickets.
6. **Stock (Phase 4, `/admin/stock`)** : `src/server/services/stock.ts`. À l'envoi en cuisine, `consumeForItems` crée un mouvement `SALE` par ligne de recette (quantité × articles, coût = coût moyen de l'ingrédient) et décrémente le stock simple des produits `trackStock` ; l'annulation d'un article envoyé ou de la commande restitue (`ADJUSTMENT` « Annulation d'article »). Les réceptions de bons de commande créent des mouvements `PURCHASE` (quantité = reçu × conditionnement, coût moyen pondéré). `refreshAvailability` bascule `products.auto_unavailable` (ingrédient critique à 0 ou stock produit épuisé) et publie `product.availability`. Inventaire = mouvements `INVENTORY` sur l'écart. Rapport = agrégation des mouvements valorisés sur la période, food cost réel = consommation nette / CA HT payé.
5. **Addition, remise (motif, PIN manager), transfert de table, annulation tracée.**
6. **Paiement** (`POST /api/orders/:id/payments`) : plusieurs moyens par addition, espèces reçues / rendu, pourboires, libellé de part (division égale / par client / par article / montant) ; clôture automatique quand soldée ; table libérée (ou « à nettoyer » selon réglage).
7. **Caisse** : ouverture (fond), mouvements (entrée / sortie / dépôt / correction manager), clôture (théorique / compté / écart), rapport X/Z imprimable, corrections post-clôture tracées.
8. **Tickets** : `GET /api/orders/:id/receipt` (`format=html|pdf|escpos`) avec HT / TVA par taux / TTC, N° Tahiti.

## Mode hors ligne et PWA

Objectif : **ne jamais perdre une commande** si Internet tombe (îles, coupures 4G).

| Brique | Rôle |
|---|---|
| `public/sw.js` (service worker) | Précache des icônes / manifeste ; ressources Next en cache d'abord ; **API GET réseau d'abord, cache en secours** (catalogue, plan de salle, commandes, profil) ; navigations réseau d'abord avec **shell générique de l'écran de commande** (`/pos/order/*`) servi hors ligne, l'identifiant étant relu depuis l'URL côté client. |
| `src/lib/offline/db.ts` | IndexedDB (`idb`) : magasin `cache` (snapshots) et `outbox` (mutations en attente). |
| `src/lib/offline/outbox.ts` | File d'attente ordonnée des mutations (méthode, URL, corps, **clé d'idempotence**). Rejouée à l'événement `online` et au chargement ; s'arrête à la première erreur réseau ; une erreur métier (4xx) retire l'entrée et remonte l'erreur à l'utilisateur. |
| `src/lib/offline/local-orders.ts` | Commandes créées ou modifiées localement : **UUID générés côté client** pour la commande, ses services et ses articles, totaux recalculés avec la même logique que le serveur (`order-calc`). Purgées après synchronisation complète. |
| `src/lib/offline/provider.tsx` | État EN LIGNE / HORS LIGNE (`useSyncExternalStore`), compteur d'opérations à synchroniser, toasts de résultat. |
| Serveur | `Idempotency-Key` (table `idempotency_keys`) et acceptation des ids fournis (`orders.id`, `courses.id`, `order_items.id`, `payments.id`) : un rejeu ne crée jamais de doublon. |

Parcours couvert hors ligne (test `e2e/offline.spec.ts`) : ouvrir une table, ajouter des articles (options comprises), envoyer en cuisine, encaisser, revenir au plan de salle (la table apparaît occupée), puis reconnexion → synchronisation, aucune duplication.

Limites connues : une commande jamais ouverte sur l'appareil n'est pas consultable hors ligne ; les conflits (commande modifiée en parallèle sur un autre poste) sont détectés par les codes 409 du serveur au rejeu et signalés, sans fusion automatique.

PWA : `manifest.webmanifest` (standalone, icônes, thème), bouton « Installer » (événement `beforeinstallprompt`, Android / Chrome / Edge) ; sur iPad : Partager → « Sur l'écran d'accueil ».

## Sécurité

HTTPS via Traefik ; cookies httpOnly/SameSite ; hachage scrypt ; validation zod ; requêtes paramétrées via Prisma ; en-têtes de sécurité (Next + Traefik) ; limitation des tentatives de connexion et de PIN ; journal d'audit non modifiable par l'API ; isolation multi-tenant ; aucune donnée de carte stockée (paiement électronique via abstraction `PaymentTerminalAdapter`, prestataires à brancher en Phase 7).

## Évolutivité

- Bus temps réel remplaçable par Redis pub/sub (interface `RealtimeBus`).
- Index sur toutes les clés étrangères et sur (établissement, statut / date).
- Catalogue POS chargé en une requête et mis en cache localement.
- Compteur de numéros de commande par établissement et par jour (`order_counters`) sans verrou global.
