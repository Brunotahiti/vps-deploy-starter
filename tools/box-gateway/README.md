# Passerelle du boîtier de secours

Programme Node.js sans dépendance qui tourne sur le mini-PC du restaurant, devant l'application ManaResto locale
(`BOX_MODE=1`). Les tablettes passent toujours par lui.

| Situation | Ce que fait la passerelle |
|---|---|
| Internet fonctionne | Relaie tout au cloud. Toutes les 30 s, recopie le restaurant dans la base du boîtier (`GET /api/box/snapshot` puis `POST /api/box/import`). |
| Internet coupé (2 vérifications ratées, ou connexion au cloud impossible) | L'application du boîtier répond. Chaque saisie réussie (`POST`/`PATCH`/`PUT`/`DELETE` sur `/api/…`) est écrite dans `outbox.jsonl` (synchronisé sur disque avant la réponse). |
| Internet revenu | Rejoue la file au cloud dans l'ordre (`X-Offline-Replay: 1`, clé d'idempotence `box-<id>` si la tablette n'en a pas mis), puis reprend le relais et rafraîchit la copie. |

Détails :
- **Mêmes identifiants** : la passerelle fixe l'id des commandes, articles, paiements et ouvertures de caisse saisis pendant la coupure, et joint à une commande ses services et son heure d'ouverture. Les bons cuisine ont un id déduit de leurs articles : la cuisine du boîtier et celle du cloud parlent des mêmes bons.
- **Connexions pendant la coupure** : ni PIN ni mot de passe ne sont gardés. Le boîtier note la personne connectée ; au retour d'internet, il demande une session du cloud pour elle (`POST /api/box/sessions`, clé du boîtier). Cette session remplace celle du boîtier, pour le rejeu puis sur la tablette (cookie renvoyé au premier passage).
- **Jamais rejoués** : impressions, tiroir, interrogations des imprimantes connectées, flux temps réel.
- **Saisie refusée par le cloud** (ex. table prise entre-temps) : notée dans `conflicts.json` et visible dans `/__box/status` ; la file continue.
- **Réponse du cloud perdue** pour une saisie déjà envoyée : la passerelle coupe la connexion de la tablette, qui la renverra (même clé d'idempotence) ; jamais de doublon.
- Fichiers de l'application du cloud (`/_next/static`, `sw.js`) gardés sur le boîtier : une page déjà ouverte continue de fonctionner pendant la coupure.
- `GET /__box/status` : mode (`relay` / `local`), saisies en attente, dernière copie, conflits. La caisse affiche un bandeau quand le boîtier a pris le relais.

## Configuration

| Variable | Rôle | Défaut |
|---|---|---|
| `CLOUD_URL` | Adresse de ManaResto en ligne | (obligatoire) |
| `BOX_TOKEN` | Clé du boîtier (`mrbox_…`, Admin → Imprimantes & tiroir → Boîtier de secours) | (obligatoire) |
| `BOX_SECRET` | Secret partagé avec l'application locale (`BOX_SECRET` de l'application, 24 caractères minimum) | (obligatoire) |
| `LOCAL_URL` | Application ManaResto du boîtier | `http://127.0.0.1:3000` |
| `DATA_DIR` | File d'attente, sessions, conflits, fichiers gardés | `/var/lib/manaresto-box` |
| `PORT` / `HOST` | Écoute | `443` avec TLS, sinon `8080` / `0.0.0.0` |
| `TLS_CERT` / `TLS_KEY` | Certificat HTTPS de l'adresse locale | — |
| `LAN_IP` | Adresse du boîtier sur le réseau du restaurant (affichée dans l'admin) | — |
| `SYNC_EVERY_MS` / `HEALTH_EVERY_MS` | Fréquence de la copie / de la vérification du cloud | `30000` / `5000` |

L'installation sur le mini-PC (Docker, HTTPS sur le réseau local) fait l'objet de la partie 3.

Tests : `tests/unit/box-gateway.test.ts` (faux cloud et fausse application) et `e2e/box-gateway.spec.ts` (vrai serveur, vraie application du boîtier sur sa propre base, coupure simulée).
