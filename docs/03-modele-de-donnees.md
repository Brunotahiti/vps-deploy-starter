# 03 — Modèle de données

Toutes les tables métier portent `establishment_id` (ou `organization_id` pour les entités partagées : utilisateurs, rôles, clients, journal d'audit). Montants en **entiers** dans l'unité mineure (XPF : 1 = 1 F). Taux en **points de base** (1300 = 13 %). Identifiants UUID (générés côté client pour les commandes / articles / paiements créés hors ligne).

| Domaine | Tables |
|---|---|
| Tenancy | `organizations`, `establishments`, `terminals`, `order_counters`, `idempotency_keys` |
| Accès | `users`, `roles`, `permissions`, `role_permissions`, `user_establishments`, `sessions` |
| Salle | `rooms`, `tables` (forme, position, taille, rotation, places, QR token, état manuel) |
| Catalogue | `tax_rates`, `categories` (arbre), `products`, `product_variants`, `modifier_groups`, `modifiers`, `product_modifier_groups`, `menus`, `menu_sections`, `menu_items`, `kitchen_stations`, `printers` |
| Commandes | `orders`, `courses` (services), `order_items` (snapshot prix/TVA/coût, siège, statut, composants de formule via `parent_item_id`), `order_item_modifiers`, `kitchen_tickets` |
| Paiement / caisse | `payment_method_configs`, `payments`, `refunds`, `cash_sessions`, `cash_movements` |
| Clients | `customers`, `loyalty_accounts`, `loyalty_transactions`, `reservations` |
| Stock (Phase 4) | `ingredients`, `recipes`, `inventory_movements`, `suppliers`, `supplier_products`, `purchase_orders`, `purchase_order_lines` |
| Personnel (Phase 5) | `employees`, `shifts`, `time_entries` |
| Audit | `audit_logs` (utilisateur, manager autorisant, terminal, action, entité, ancienne / nouvelle valeur, motif, IP) |

## Calculs

- **Ligne** : `line_total = (unit_price + modifiers_total) × quantity − discount_amount` ; `HT = arrondi(TTC × 10000 / (10000 + taux))`, `TVA = TTC − HT` (`src/lib/money.ts`).
- **Commande** : remise globale répartie au prorata des lignes puis ventilation par taux (`src/lib/order-calc.ts`) ; `total = Σ TTC`, `tax_total = Σ TVA`, `HT + TVA = TTC` garanti.
- **Formule** : ligne parent au prix de la formule + lignes composants au prix du supplément (options incluses), rattachées par `parent_item_id`.
- **Caisse** : `espèces théoriques = Σ cash_movements.amount` (ouverture + ventes espèces − remboursements + entrées − sorties − dépôts ± corrections).

Le schéma complet est dans `prisma/schema.prisma` ; la migration initiale dans `prisma/migrations/`.
