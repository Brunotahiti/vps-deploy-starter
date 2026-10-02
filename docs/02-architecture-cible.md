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
7. **Personnel et rapports (Phase 5)** : `src/server/services/staff.ts` — l'employé est identifié par son PIN propre, sinon par le PIN de son compte lié ; `clockState` reconstruit l'état (hors service / en service / en pause) à partir des 20 dernières heures de pointages et n'autorise que les transitions valides ; `computeHours` calcule heures et pauses (session ouverte comptée jusqu'à maintenant) ; `staffSummary` valorise au coût horaire et rapporte au CA HT. `getPeriodReport` (reports.ts) agrège les commandes clôturées sur la période et calcule la période précédente de même durée. Les exports (`src/server/reports/export.ts`) construisent des « feuilles » communes rendues en CSV (`;`, BOM UTF-8), Excel (exceljs) ou PDF A4 (pdfkit).
8. **Canaux clients (Phase 6)** : `src/server/services/public.ts` — pages publiques sans session (`/m/:qrToken`, `/commander/:org/:etab`, `/suivi/:token`, `/reserver/:org/:etab`) et borne `/kiosk` (cookie terminal). Les commandes clients sont créées par un « acteur système » (propriétaire de l'entreprise) via les mêmes services que la caisse (`createOrder`, `addItem`, `sendCourse`) : mêmes règles, mêmes tickets cuisine, même stock. `orders.public_token` porte le suivi public, `orders.channel_meta` le canal (retrait / livraison / borne, adresse, zone, frais, langue) et `accepted_at` l'acceptation par le restaurant ; le suivi calcule l'étape à partir des statuts d'articles. `tables.call_requested_at` = appel serveur (événement `table.updated`). Fidélité (`customers.ts`) : points crédités dans la transaction de paiement (`earnLoyalty`), récompense = remise tracée. Réservations (`reservations.ts`) : machine à états, « installer » crée la commande sur la table. i18n client : dictionnaires `src/lib/i18n/public.tsx` (fr, en, ty), langue mémorisée localement ou via `?lang=`.
9. **Avancé (Phase 7)** : `src/server/api-keys.ts` (clés hachées SHA-256, portées, `requireApiKey`), routes `/api/v1/*` ; `src/server/webhooks.ts` (enregistré comme hook du bus : chaque `publish` déclenche les livraisons signées, asynchrones, journalisées) ; `src/server/hardware/printers.ts` (TCP 9100 côté serveur, ou rendu ESC/POS renvoyé en base64 au navigateur pour l'agent local ; auto-impression cuisine dans `sendCourse`) ; `src/server/hardware/payment-terminal.ts` (adaptateur passerelle HTTP, `chargeOnTerminal` audité) ; `src/server/services/organization.ts` (vue consolidée, copie de catalogue transactionnelle par nom) ; export comptable dans `src/server/reports/export.ts` ; `RedisBus` dans `src/server/realtime/bus.ts` (canal `manaresto:realtime`, repli mémoire).
5. **Addition, remise (motif, PIN manager), transfert de table, annulation tracée.**
6. **Paiement** (`POST /api/orders/:id/payments`) : plusieurs moyens par addition, espèces reçues / rendu, pourboires, libellé de part (division égale / par client / par article / montant) ; clôture automatique quand soldée ; table libérée (ou « à nettoyer » selon réglage).
7. **Caisse** : ouverture (fond), mouvements (entrée / sortie / dépôt / correction manager), clôture (théorique / compté / écart), rapport X/Z imprimable, corrections post-clôture tracées.
8. **Tickets** : `GET /api/orders/:id/receipt` (`format=html|pdf|escpos`) avec HT / TVA par taux / TTC, N° Tahiti.

## Mode hors ligne et PWA

Objectif : **ne jamais perdre une commande** si Internet tombe (îles, coupures 4G).

| Brique | Rôle |
|---|---|
| `src/pwa/sw-source.ts`, servi par `src/app/sw.js/route.ts` (service worker) | **Tous les fichiers de l'application** (JS/CSS de Next, polices, icônes, visuels de connexion) enregistrés dès l'installation, puis les portails publics ; après la connexion (message `WARM`), les écrans du service (`/pos`, `/pos/orders`, `/pos/cash`, `/kds`) et le **shell générique de l'écran de commande** (`/pos/order/*`, l'identifiant est relu depuis l'URL). Navigations réseau d'abord, cache en secours : l'application **démarre à froid sans internet**. API : jamais servie depuis ce cache (sauf `/api/auth/me`) ; les copies de travail sont dans IndexedDB. |
| `src/lib/offline/snapshot.ts` | Copie de travail tenue à jour en ligne (toutes les 60 s) : catalogue et **toutes les commandes en cours** (une table ouverte sur une autre tablette reste consultable et encaissable hors ligne). Rien n'est écrasé tant que des saisies attendent d'être transmises. |
| `src/lib/offline/db.ts` | IndexedDB (`idb`) : magasin `cache` (copies) et `outbox` (mutations en attente). |
| `src/lib/offline/outbox.ts` | File d'attente ordonnée des mutations (méthode, URL, corps, **clé d'idempotence**, en-tête `X-Offline-Replay`). Rejouée à l'événement `online`, au chargement, au retour au premier plan et toutes les 20 s ; s'arrête à la première erreur réseau ; un refus métier (4xx) retire l'entrée et la garde dans le journal `outbox-failed`. |
| `src/lib/offline/local-orders.ts` | Commandes créées ou modifiées localement : **UUID générés côté client** pour la commande, ses services et ses articles, totaux recalculés avec la même logique que le serveur (`order-calc`). Plan de salle : tables encaissées ou libérées sur l'appareil affichées libres tant que la file n'est pas vidée (`applyFloorOverrides`). |
| `src/server/services/offline-pass.ts`, `src/lib/offline/passes.ts`, `pass-crypto.ts`, `auth-state.ts` | **Connexion par PIN sans internet.** Le serveur ne garde jamais le PIN : quand il le voit en clair (connexion par PIN, autorisation manager, PIN défini), il en dérive une clé (PBKDF2-SHA256, 210 000 itérations, sel propre à l'établissement, table `offline_pin_keys`). Chaque terminal enregistré reçoit, pour chaque employé, un **laissez-passer chiffré** (AES-256-GCM) par cette clé (`GET /api/auth/offline-passes`, réémis chaque jour). Hors ligne, le PIN saisi ouvre le laissez-passer de son titulaire (WebCrypto) : profil, droits et jeton. Le jeton (haché en base, table `offline_passes`, lié au terminal, 14 jours, révoqué au changement de PIN, à la désactivation ou au retrait de l'établissement) signe les opérations mises en file (`X-Offline-Pass`) : elles sont rejouées **au nom de qui les a saisies**, même si la session de la tablette a expiré. Autorisation manager hors ligne : PIN du manager vérifié sur la tablette, jeton du manager joint (`X-Offline-Manager`), droits revérifiés en base au rejeu. Au retour du réseau, le laissez-passer est échangé contre une vraie session (`POST /api/auth/offline-session`). Limite assumée, comme toute caisse hors ligne : quelqu'un qui extrairait les données de la tablette pourrait tenter tous les PIN hors ligne ; la dérivation lente, le lien au terminal, l'expiration et les révocations en limitent la portée. |
| `src/lib/offline/provider.tsx` | État EN LIGNE / HORS LIGNE (`useSyncExternalStore`), compteur d'opérations à synchroniser, toasts de résultat. |
| Serveur | `Idempotency-Key` (table `idempotency_keys`) et acceptation des ids fournis (`orders.id`, `courses.id`, `order_items.id`, `payments.id`) : un rejeu ne crée jamais de doublon. **Espèces encaissées hors ligne** : jamais refusées au rejeu, même sans caisse ouverte (ou caisse clôturée pendant la coupure) ; elles rejoignent la prochaine session ouverte avec leur mouvement « Vente hors ligne » (`attachOfflineCashPayments`). |

Connexion hors ligne : changement d'utilisateur et connexion par PIN (employés déjà vus une fois en ligne, ou comptes de démonstration), copie de travail conservée au changement d'utilisateur sur un terminal du restaurant, déconnexion du serveur terminée au retour du réseau.
Opérations possibles hors ligne : ouvrir une table, ajouter / modifier / supprimer un article non envoyé, envoyer en cuisine, statut des suites (attente, faire marcher, servi), couverts et nom du client, demander l'addition, encaisser (espèces, carte saisie à la main, chèque…), étapes du suivi de service, libérer une table à nettoyer, prendre en charge un appel de table.
Sous PIN manager, hors ligne aussi (vérifié sur la tablette) : remise, annulation, offert, suppression d'un article envoyé.
**Impression sans internet** (`src/lib/offline/print-local.ts`, documents de `src/lib/escpos.ts` partagés avec le serveur) : la tablette construit elle-même le ticket client et les bons cuisine, et les envoie à l'imprimante du réseau local par l'agent d'impression (pilote « agent », `tools/print-agent`), ou les imprime par le navigateur. Les imprimantes (sans secret) sont dans le catalogue de la caisse, gardé hors ligne. Envoi en cuisine pendant une coupure : bon imprimé tout de suite sur l'imprimante cuisine de l'agent (mention « envoyé sans internet »). Encaissement espèces : tiroir ouvert par l'agent. Au rejeu, le serveur n'ouvre jamais le tiroir. Une imprimante pilotée par le serveur (réseau TCP, connectée Epson/Star) n'est pas joignable depuis une tablette sans internet ; c'est le rôle du boîtier local (étape 2).
**Caisse sans internet** (`src/lib/offline/cash-local.ts`) : ouverture (identifiant créé par la tablette, rejeu sans doublon ; si une caisse a été ouverte entre-temps sur le terminal, la tablette la rejoint et le fond saisi est tracé), entrées/sorties d'espèces et clôture partent en file d'attente (clés d'idempotence) ; la tablette tient sa propre copie de la session (espèces théoriques, ventes par moyen de paiement) et calcule l'écart à la clôture. Au retour du réseau, le serveur refait le calcul et sa version remplace la copie locale.
Requêtes : `networkMode: "always"` (React Query) — sans internet les requêtes s'exécutent et lisent les copies locales ; en mode par défaut elles étaient mises en pause pendant la coupure (écrans figés).
Encore en ligne seulement : transfert de table, client et fidélité, TPE connecté, écran cuisine (sans le boîtier local, il ne reçoit rien pendant la coupure ; les bons sont imprimés).

Parcours testés (`e2e/offline.spec.ts`) : table ouverte hors ligne → articles → envoi → reconnexion sans doublon ; table ouverte en même temps sur un autre appareil (articles regroupés) ; **démarrage à froid sans réseau** et encaissement espèces d'une table ouverte sur un autre appareil, table libérée sur le plan, paiement transmis au retour du réseau ; **changement d'utilisateur et connexion par PIN sans réseau**, remise autorisée par le PIN du manager vérifié sur la tablette, rejeu au nom de la serveuse avec l'autorisation du manager (journal d'audit). Les tests coupent aussi le réseau du service worker (`PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS`). `e2e/offline-print-cash.spec.ts` : vrai agent d'impression et fausse imprimante TCP sur le réseau local, serveur coupé : ouverture de caisse, entrée d'espèces, bon cuisine imprimé, tiroir ouvert et ticket imprimé à l'encaissement, clôture avec écart nul ; au retour du réseau, session close côté serveur avec les mêmes espèces théoriques.

PWA : `manifest.webmanifest` (standalone, icônes, thème), bouton « Installer » (événement `beforeinstallprompt`, Android / Chrome / Edge) ; sur iPad : Partager → « Sur l'écran d'accueil ».

## Sécurité

HTTPS via Traefik ; cookies httpOnly/SameSite ; hachage scrypt ; validation zod ; requêtes paramétrées via Prisma ; en-têtes de sécurité (Next + Traefik) ; limitation des tentatives de connexion et de PIN ; journal d'audit non modifiable par l'API ; isolation multi-tenant ; aucune donnée de carte stockée (paiement électronique via abstraction `PaymentTerminalAdapter`, prestataires à brancher en Phase 7).

## Évolutivité

- Bus temps réel remplaçable par Redis pub/sub (interface `RealtimeBus`).
- Index sur toutes les clés étrangères et sur (établissement, statut / date).
- Catalogue POS chargé en une requête et mis en cache localement.
- Compteur de numéros de commande par établissement et par jour (`order_counters`) sans verrou global.
