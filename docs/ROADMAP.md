# Feuille de route ManaResto

| Phase | Contenu | État |
|---|---|---|
| **1 — Socle** | authentification (email + PIN), multi-tenant, établissements, utilisateurs, rôles & permissions, produits, catégories, variantes, options, formules, TVA configurable, paramètres, terminaux, onboarding, import CSV | ✅ livré |
| **2 — Caisse** | interface POS tablette, plan de salle (éditeur + statut temps réel), commandes (services, sièges, urgent, à suivre, faire marcher, ne pas envoyer), tickets cuisine routés par poste, addition, division (égale / client / article / montant), paiements multi-moyens, pourboires, remises et annulations tracées (PIN manager), transfert de table, caisse (ouverture / mouvements / clôture / X-Z / corrections), tickets HTML-PDF-ESC/POS, journal d'audit, tableau de bord et rapports du jour, temps réel SSE, mode hors ligne (cache + outbox idempotente + indicateur) | ✅ livré |
| **3 — Cuisine** | écran KDS par poste (ACCEPTER / EN PRÉPARATION / PRÊT / TERMINÉ), temps écoulé et alertes, synchronisation des statuts vers la salle, impression cuisine | ⏳ à faire — les `kitchen_tickets` et événements `kitchen.updated` existent déjà |
| **4 — Stock** | ingrédients, recettes, décrémentation automatique, inventaires, pertes, fournisseurs, bons de commande, réceptions, food cost et alertes, ruptures automatiques | ⏳ modèles créés, logique à faire |
| **5 — Gestion** | personnel, pointage (ARRIVÉE / PAUSE / REPRISE / DÉPART), coût du personnel, rapports périodiques et comparaisons, exports CSV/Excel/PDF | ⏳ modèles créés |
| **6 — Digital** | QR code à table (4 modes), commande en ligne (click & collect / livraison), borne kiosque, fidélité, réservations, i18n FR/EN/tahitien | ⏳ modèles créés (`tables.qr_token`, `customers`, `loyalty_*`, `reservations`) |
| **7 — Avancé** | multi-sites avancé, exports comptables PF, API publique, webhooks, intégrations bancaires (`PaymentTerminalAdapter`), transport imprimantes (`PrinterAdapter`), Redis pub/sub multi-instance | ⏳ interfaces définies |

Les écrans des phases suivantes ne sont **pas simulés** : la navigation les indique comme « prévu Phase N ».
