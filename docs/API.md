# API ManaResto (Phases 1–3)

Toutes les réponses sont `{ "data": … }` ou `{ "error": { "code", "message", "details" } }`. Authentification par cookie de session. Les mutations sensibles acceptent `managerPin` (autorisation ponctuelle) et renvoient `403 PIN_REQUIRED` sinon. Les créations de commandes / articles / envois / paiements acceptent l'en-tête `Idempotency-Key` (rejeu sûr après reconnexion).

| Méthode | Route | Permission |
|---|---|---|
| POST | `/api/auth/login`, `/signup`, `/logout`, `/pin`, `/authorize`, `/switch-establishment`, `/terminal/register`, `/terminal/unregister` | — / settings.manage |
| GET | `/api/auth/me` | — |
| GET/POST/PATCH | `/api/establishments[/:id]` | establishments.manage / settings.manage |
| GET/POST/PATCH | `/api/users[/:id]`, `/api/roles[/:id]`, `/api/permissions` | users.manage |
| GET/POST/PATCH/DELETE | `/api/tax-rates`, `/api/categories` (+`/reorder`), `/api/products` (+`/:id/availability`, `/import`), `/api/modifier-groups`, `/api/menus`, `/api/kitchen-stations` | catalog.view / catalog.manage / catalog.availability |
| GET | `/api/pos/catalog` | pos.use |
| GET | `/api/floor` · PUT `/api/floor/layout` · `/api/rooms`, `/api/tables` (+`/:id/state`) | pos.use / floor.manage |
| GET/POST | `/api/orders` (`?open=1`, `?day=`, `?status=`) · GET/PATCH `/api/orders/:id` | pos.use |
| POST | `/api/orders/:id/items` · PATCH/DELETE `/items/:itemId` · `/send` · `/courses/:courseId` · `/discount` · `/bill` · `/cancel` · `/transfer` · `/payments` | pos.use (+ pos.void_item / pos.discount / pos.cancel_order / pos.transfer_table) |
| GET | `/api/orders/:id/receipt?format=html|pdf|escpos` | pos.use |
| GET | `/api/kitchen/tickets` (`?stationId=`, `?includeDone=1`) · `/api/kitchen/summary` | kds.use |
| POST | `/api/kitchen/tickets/:id/status` `{status: ACCEPTED|IN_PROGRESS|READY|DONE}` · `/api/kitchen/tickets/:id/items/:itemId` `{ready}` | kds.use |
| GET | `/api/kitchen/tickets/:id/print?format=html|escpos` (`&print=1` : impression automatique) | kds.use ou pos.use |
| POST | `/api/payments/:id/refund` | pos.refund |
| GET/POST | `/api/cash`, `/api/cash/current`, `/api/cash/open`, `/api/cash/:id`, `/:id/movements`, `/:id/close`, `/:id/report` | cash.open / cash.movement / cash.correct / cash.close |
| GET | `/api/reports/daily?day=`, `/range?from&to`, `/overview` | reports.view / reports.view_global |
| GET | `/api/audit` | audit.view |
| GET | `/api/realtime` (SSE) · `/api/health` | — |
