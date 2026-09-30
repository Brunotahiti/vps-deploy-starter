# API ManaResto (Phases 1–7)

API publique par clé : voir `docs/API-PUBLIQUE.md` (`/api/v1/*`).

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
| GET/POST/PATCH/DELETE | `/api/stock/ingredients[/:id]` · GET `/:id/movements` | stock.view / stock.manage |
| GET/POST | `/api/stock/movements` (`?ingredientId&kind&from&to`) — POST : PURCHASE / ADJUSTMENT / LOSS / BREAKAGE / INTERNAL_USE | stock.view / stock.manage |
| POST | `/api/stock/inventory` `{lines:[{ingredientId, countedQty}]}` | stock.manage |
| GET/PUT | `/api/stock/recipes/:productId` `{lines:[{ingredientId, quantity}], applyCost}` | stock.view / stock.manage |
| GET | `/api/stock/alerts` · `/api/stock/suggest` · `/api/stock/report?from&to` | stock.view |
| GET/POST/PATCH/DELETE | `/api/suppliers[/:id]` · GET/POST `/api/suppliers/:id/products` · PATCH/DELETE `/api/supplier-products/:id` | stock.view / stock.manage |
| GET/POST/PATCH | `/api/purchase-orders[/:id]` · POST `/:id/send`, `/:id/receive` `{lines:[{lineId, receivedQty}]}`, `/:id/cancel` | stock.view / stock.manage |
| POST | `/api/payments/:id/refund` | pos.refund |
| GET/POST | `/api/cash`, `/api/cash/current`, `/api/cash/open`, `/api/cash/:id`, `/:id/movements`, `/:id/close`, `/:id/report` | cash.open / cash.movement / cash.correct / cash.close |
| GET | `/api/reports/daily?day=`, `/range?from&to`, `/overview` · `/api/reports/period?from&to` (comparaison incluse) | reports.view / reports.view_global |
| GET | `/api/reports/export?type=period|products|orders|staff&format=csv|xlsx|pdf&from&to` | reports.view / orders.view_history / staff.manage |
| GET/POST/PATCH/DELETE | `/api/staff/employees[/:id]` · POST `/from-users` · `/api/staff/shifts[/:id]` (`?from&to`) · `/api/staff/entries[/:id]` (`?from&to&employeeId`, corrections motivées) · GET `/api/staff/summary?from&to` | staff.manage |
| POST | `/api/staff/clock/identify` `{pin}` · `/api/staff/clock` `{pin, kind: CLOCK_IN|BREAK_START|BREAK_END|CLOCK_OUT}` · GET `/api/staff/present` | session (tout membre connecté) |
| GET | `/api/audit` | audit.view |
| GET | `/api/public/menu/:qrToken` · POST `/order` `{id, lines, covers?, notes?}` · POST `/call` | public (QR de table) |
| GET | `/api/public/shop/:org/:etab` · POST `/order` `{id, mode: PICKUP|DELIVERY, name, phone, …, lines}` · POST `/reserve` | public |
| GET | `/api/public/track/:publicToken` | public (jeton de suivi) |
| GET/POST | `/api/kiosk/catalog` · `/api/kiosk/order` `{id, mode, name?, lines}` | cookie terminal de type KIOSK |
| GET/POST | `/api/online-orders` · `/:id/accept` · `/:id/reject` `{reason}` · DELETE `/api/tables/:id/call` · GET `/api/tables/qr`, `/api/tables/:id/qr` (PNG) | pos.use / floor.manage |
| GET/POST/PATCH | `/api/customers[/:id]` (`?search=`) · POST `/:id/points` · POST `/api/orders/:id/customer` `{customerId}` · POST `/api/orders/:id/loyalty` `{rewards}` | customers.manage / pos.use |
| GET/POST/PATCH | `/api/reservations[/:id]` (`?day=`) · POST `/:id/status` `{status, tableId?}` | pos.use / customers.manage |
| GET/PATCH | `/api/digital/settings` (QR, en ligne, borne, fidélité) | settings.manage |
| GET/POST/DELETE | `/api/integrations/api-keys[/:id]` · `/api/integrations/webhooks[/:id]` (+ PATCH, POST `/:id/test`) | settings.manage |
| GET/POST/PATCH/DELETE | `/api/printers[/:id]` · POST `/api/print` `{printerId, kind: receipt|kitchen|test, orderId?, ticketId?}` | pos.use / settings.manage |
| GET/PATCH/POST | `/api/payments/terminal/settings` · `/api/payments/terminal/charge` `{orderId, amount}` | pos.use / settings.manage |
| GET/POST | `/api/organization/overview?from&to` · `/api/establishments/:id/copy-catalog` `{fromId}` | reports.view_global / establishments.manage |
| GET | `/api/reports/export?type=accounting` (export comptable) | audit.view |
| GET | `/api/service/reminders` (rappels dus et à venir) · POST `/api/service/reminders/:id/done` · POST `/api/service/reminders/:id/snooze` `{minutes}` | pos.use |
| GET | `/api/service/orders/:id/timeline` · POST `/api/service/orders/:id/steps/:key` `{status, reason?}` · POST `/api/service/orders/:id/server` `{serverId}` | pos.use |
| GET/PATCH | `/api/service/settings` (activation, délais, son, vibration, attribution, étapes) | pos.use / settings.manage |
| GET | `/api/realtime` (SSE) · `/api/health` | — |
