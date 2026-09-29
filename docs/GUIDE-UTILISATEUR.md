# Guide utilisateur ManaResto

ManaResto est une caisse et un back-office pour les restaurants de Polynésie française : montants en F CFP sans décimales, TVA configurable, N° Tahiti sur les tickets, utilisable sur tablette, téléphone et ordinateur, y compris hors ligne.

## 1. Premiers pas

1. **Créer votre entreprise** : `/onboarding` (nom, N° Tahiti, premier établissement, compte propriétaire).
2. **Se connecter** : `/login` avec e-mail et mot de passe. Sur une tablette de caisse, enregistrez l'appareil (**Paramètres → Terminaux**) : l'équipe se connecte ensuite par **PIN** sur `/pos/login`.
3. **Installer l'application** : bouton « Installer l'application » dans le menu (ou « Sur l'écran d'accueil » depuis Safari sur iPhone / iPad).

## 2. Catalogue

**Administration → Catalogue** : catégories, produits (prix TTC, taux de TVA, coût, variantes, code-barres, photo), groupes d'options (cuisson, suppléments…), formules (entrée + plat…), taux de TVA. **Import CSV** pour charger un catalogue existant.

## 3. Salle et caisse

- **Plan de salle** : salles, tables (forme, places, position), statut en temps réel (libre, occupée, addition demandée, plats prêts, appel serveur, réservée).
- **Caisse** `/pos` : ouvrir une table ou une vente au comptoir, ajouter des produits (touchez la vignette pour le détail, « + » pour l'ajout rapide), services (« envoyer », « à suivre », « faire marcher », urgent), sièges, notes, remises et annulations (PIN manager, motif tracé), transfert de table.
- **Addition et paiement** : division égale, par client, par article ou par montant ; espèces, carte (ou « Envoyer au TPE » si un terminal est connecté), chèque, virement, autre ; pourboires ; reçu imprimé, envoyé par e-mail (PDF) ou affiché.
- **Caisse** `/pos/cash` : ouverture avec fonds, mouvements (entrées / sorties motivées), clôture avec comptage et écart, rapports X et Z.
- **Hors ligne** : la caisse continue de fonctionner sans réseau (commandes, envois) et se synchronise au retour de la connexion ; l'indicateur en haut affiche l'état.

## 4. Cuisine

**Écran cuisine** `/kds` par poste (cuisine, bar…) : accepter, en préparation, prêt, terminé, article par article, temps écoulé avec alertes, rappel d'un ticket, bip à l'arrivée. Les statuts remontent sur la salle (« plats prêts »). Les bons cuisine s'impriment aussi (navigateur ou imprimante configurée).

## 5. Stocks et achats

**Stocks & achats** : ingrédients (unité, seuil, coût moyen), recettes par produit (coût matière, marge), **décrémentation automatique à l'envoi en cuisine**, inventaires (écart valorisé), pertes et casse tracées, fournisseurs et bons de commande (envoi, réception partielle ou totale, entrées en stock), suggestions de commande, **rupture automatique** en caisse quand un ingrédient critique est épuisé, rapport (consommation, achats, pertes, food cost).

## 6. Personnel

**Personnel** : fiches employés (coût horaire, PIN de pointage), planning hebdomadaire, **pointeuse** `/pos/clock` (arrivée, pause, reprise, départ), corrections manager, heures et coût du personnel, prime cost sur le tableau de bord.

## 7. Rapports et exports

**Tableau de bord** (jour) et **Rapports & exports** (période) : synthèse et comparaison, par jour, heure, catégorie, produit, serveur, moyen de paiement, type de vente. Exports **CSV, Excel, PDF** : rapport, ventes par produit, commandes, personnel, **export comptable** (journal de caisse, ventes par taux de TVA, encaissements, écritures).

## 8. Digital

**Digital : QR, en ligne, borne** :
- **QR code à table** : menu seul, menu + appel serveur, commande validée par le personnel, ou commande directe. QR codes imprimables par table.
- **Commande en ligne** `/commander/<entreprise>/<établissement>` : click & collect et livraison (zones, frais, minimum), acceptation en caisse (onglet « En ligne & borne »), suivi client `/suivi/<code>`.
- **Borne** `/kiosk` sur un appareil enregistré de type Borne.
- **Fidélité** : points au paiement, récompense en remise, fiche client en caisse.
- **Réservations** : formulaire public `/reserver/…`, écran caisse (confirmer, arrivée, installer, no-show).
- Interfaces clients en français, anglais et reo tahiti.

## 9. Intégrations

**Intégrations : API, webhooks, imprimantes, TPE** :
- **Clés API** pour vos partenaires (comptable, site, automatisations) : voir `docs/API-PUBLIQUE.md`.
- **Webhooks** : notification signée à chaque événement (commande clôturée…), test et journal.
- **Imprimantes** : réseau ESC/POS (serveur sur place), agent d'impression local (`tools/print-agent`) ou navigateur ; bons cuisine auto-imprimés par poste.
- **TPE** : mode manuel ou passerelle HTTP (bouton « Envoyer au TPE »).

**Multi-sites** : vue consolidée de tous vos établissements, comparaison, copie de catalogue.

## 10. Utilisateurs, rôles et audit

**Utilisateurs** : comptes, rôles (propriétaire, manager, serveur, cuisine, bar, caissier… personnalisables par permission), PIN. **Journal d'audit** : toute action sensible (remise, annulation, correction, paramètres, clés API) est tracée avec l'auteur et le motif.

## 11. Sécurité

Sessions chiffrées par cookie, PIN et mots de passe hachés, tentatives limitées (connexion, PIN, formulaires publics, API), en-têtes de sécurité HTTP, permissions vérifiées côté serveur sur chaque route, isolation stricte par établissement.

## Compte de démonstration

`demo@manaresto.pf` / `demo1234` (PIN 1234) — établissement « Le Mana Beach ». Manager : PIN 2000, cuisine : 3000, bar : 4000, serveurs : 1001 à 1005.
