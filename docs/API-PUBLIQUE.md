# API publique ManaResto (v1)

Base : `https://<votre-domaine>/api/v1`. Authentification par clé, créée dans **Administration → Intégrations → Clés API** (affichée une seule fois) :

```
Authorization: Bearer mr_live_xxxxxxxx
```

Réponses `{ "data": … }` ou `{ "error": { "code", "message" } }`. Montants en F CFP entiers, dates ISO 8601 (UTC), jours `AAAA-MM-JJ` dans le fuseau de l'établissement.

| Méthode | Route | Portée | Description |
|---|---|---|---|
| GET | `/me` | catalog:read ou orders:read | établissement, portées de la clé |
| GET | `/orders?from&to&status&take&skip` | orders:read | commandes (clôturées ou en cours) sur une période |
| GET | `/orders/:id` | orders:read | détail d'une commande (articles, options, paiements) |
| POST | `/orders` `{ id?, customerName?, notes?, lines: [{ id, productId | menuId, variantId?, quantity, modifiers?, menuSelections?, notes? }] }` | orders:write | crée une commande « canal API » à accepter en caisse (onglet En ligne & borne) |
| GET | `/products` | catalog:read | catalogue disponible (catégories, produits, variantes, options, formules) |
| GET | `/reports/daily?day=` ou `?from&to` | reports:read | synthèse du jour ou rapport de période (avec comparaison) |
| GET | `/stock/ingredients` | stock:read | ingrédients, stocks, alertes |
| GET | `/customers?search=` | customers:read | clients, visites, dépenses, points |

## Webhooks

Créés dans **Intégrations → Webhooks** (secret affiché une seule fois). À chaque événement, ManaResto envoie :

```
POST <url>
Content-Type: application/json
X-ManaResto-Event: order.closed
X-ManaResto-Signature: sha256=<HMAC-SHA256(secret, corps brut)>

{ "id": "…", "event": "order.closed", "establishmentId": "…", "at": "2026-09-29T20:00:00.000Z", "data": { "orderId": "…", "tableId": "…" } }
```

Événements : `order.created`, `order.updated`, `order.closed`, `kitchen.updated`, `table.updated`, `cash.updated`, `product.availability`, `catalog.updated`, `floor.updated` (ou `*`). Trois tentatives (0 s, 1 s, 5 s), journal des livraisons visible dans l'administration, désactivation automatique après 20 échecs consécutifs. Vérifiez la signature avant de traiter un message ; répondez `2xx` rapidement.

Exemple de vérification (Node) :

```js
import { createHmac } from "node:crypto";
const expected = "sha256=" + createHmac("sha256", SECRET).update(rawBody).digest("hex");
if (req.headers["x-manaresto-signature"] !== expected) return res.status(401).end();
```

## Terminal de paiement (passerelle)

**Intégrations → TPE**, mode « Passerelle HTTP ». ManaResto appelle :

- `POST {url}/charge` `{ amount, currency, reference, terminalId }` → `{ ok: true, providerRef }` ou `{ ok: false, message }`
- `POST {url}/refund` `{ providerRef, amount, terminalId }` → `{ ok, message? }`

En-tête `Authorization: Bearer <clé>` si renseignée. Aucune donnée de carte ne transite par ManaResto.

## Impression

Pilotes d'imprimante : réseau ESC/POS (TCP 9100 depuis le serveur), agent local (`tools/print-agent`, HTTP depuis la tablette), navigateur (HTML). Les bons cuisine s'impriment automatiquement à l'envoi sur l'imprimante réseau du poste.

## Plusieurs instances

Définir `REDIS_URL` (ex. `redis://redis:6379`) : le temps réel (SSE) est partagé entre instances via Redis pub/sub. Sans Redis, une seule instance.
