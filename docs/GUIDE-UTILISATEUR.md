# Guide utilisateur ManaResto

ManaResto est une caisse et un back-office pour les restaurants de Polynésie française : montants en F CFP sans décimales, TVA configurable, N° Tahiti sur les tickets, utilisable sur tablette, téléphone et ordinateur, y compris hors ligne.

## 1. Premiers pas

1. **Créer votre entreprise** : `/onboarding` (nom, N° Tahiti, premier établissement, compte propriétaire).
2. **Se connecter** : `/login` avec e-mail et mot de passe. Sur une tablette de caisse, enregistrez l'appareil (**Paramètres → Terminaux**) : l'équipe se connecte ensuite par **PIN** sur `/pos/login`.
3. **Installer l'application** : bouton « Installer l'application » dans le menu (ou « Sur l'écran d'accueil » depuis Safari sur iPhone / iPad).
4. **Mettre à jour** : après chaque déploiement, un bandeau « Nouvelle version disponible » apparaît en bas de l'écran (au retour au premier plan ou dans la demi-heure). Touchez **Mettre à jour** : l'application se recharge avec la nouvelle version. Le numéro de version installé est affiché en bas du menu d'administration.

## 2. Catalogue

**Administration → Catalogue** : catégories, produits (prix TTC, taux de TVA, coût, variantes, code-barres, photo), groupes d'options (cuisson, suppléments…), formules (entrée + plat…), taux de TVA. **Import CSV** pour charger un catalogue existant.

**Photos des plats** : dans la fiche d'un produit ou d'une formule, « Prendre ou choisir une photo » ouvre l'appareil photo ou la galerie du téléphone ; la photo est réduite automatiquement (1000 px) et stockée avec vos données (incluse dans les sauvegardes). Elle apparaît en grand sur les vignettes de la caisse, sur le menu QR, la commande en ligne, la borne et le site du restaurant. Une URL d'image reste possible.

## 3. Salle et caisse

- **Plan de salle** : salles, tables (forme, places, position), statut en temps réel (libre, occupée, addition demandée, plats prêts, appel serveur, réservée).
- **Caisse** `/pos` : ouvrir une table ou une vente au comptoir, ajouter des produits (touchez la vignette pour le détail, « + » pour l'ajout rapide), services (« envoyer », « à suivre », « faire marcher », urgent), sièges, notes, remises et annulations (PIN manager, motif tracé), transfert de table.
- **Addition et paiement** : division égale, par client, par article ou par montant ; espèces, carte (ou « Envoyer au TPE » si un terminal est connecté), chèque, virement, autre ; reçu imprimé, envoyé par e-mail (PDF) ou affiché.
- **Mode roulotte** (Paramètres → Caisse, activé d'office pour un snack ou une roulotte) : tout se passe à la caisse. L'accueil `/pos` est directement l'écran **Comptoir** : le client choisit sur l'écran, **sur place ou à emporter** (choix en haut du ticket), un seul bouton **« Encaisser et envoyer en cuisine »** encaisse puis envoie la commande en cuisine (bons imprimés, écran cuisine prévenu). Quand la cuisine appuie sur « Prêt », le serveur reçoit la notification « plat prêt », un bandeau vert apparaît en haut du Comptoir et sur l'écran **À emporter** : il va chercher le plat en cuisine, l'apporte au client (ou appelle le numéro pour une commande à emporter), puis appuie sur **« Remis »**. « Commande suivante » enchaîne ; un rechargement de la page retrouve la commande en cours.
- **Caisse** `/pos/cash` : ouverture avec fonds, mouvements (entrées / sorties motivées), clôture avec comptage et écart, rapports X et Z.
- **Fin de service** `/pos/recap` (bouton « Fin de service » de l'écran Caisse et du menu) : la journée en une page, belle et complète : couverts, tickets, ticket moyen et par couvert, CA TTC / HT / TVA, remises, remboursements, net encaissé, annulations, commandes encore ouvertes, **marge brute et coût matière** (droit Rapports), personnel (option Équipe), encaissements par moyen de paiement, caisses du jour (fond, espèces théoriques, comptées, écart), ventes par type (sur place, comptoir, à emporter…), par serveur, par catégorie, produits les plus vendus, ventes par heure et heure de pointe, temps de préparation en cuisine, comparaison avec il y a 7 jours. Trois impressions : **ticket** sur l'imprimante de caisse, **page A4 / PDF**, ou l'écran lui-même. Accessible aux personnes qui clôturent la caisse ou consultent les rapports ; une autre date se choisit en haut.
- **Hors ligne** : la caisse continue de fonctionner sans réseau (commandes, envois) et se synchronise au retour de la connexion ; l'indicateur en haut affiche l'état.

## 3 bis. Suivi de service (ne plus oublier une table)

À l'installation d'une table, ManaResto démarre son **parcours de service** (accueil, boissons, vérifications, plats, dessert, addition) et crée un premier rappel. Ensuite :
- un plat **prêt en cuisine** crée l'action « À apporter » pour le serveur de la table ; « Apporté » (dans la commande ou depuis le rappel) marque les articles servis et programme la vérification suivante ;
- après les boissons vient la prise de commande des plats ; après les plats, « tout se passe bien ? » puis la proposition du dessert et du café ; après le dessert, un passage de courtoisie puis l'addition.

Le bouton **« À faire »** en haut de la caisse ouvre le panneau **À faire maintenant** : actions classées par priorité (en retard d'abord, puis à apporter, prise de commande, vérification, dessert, addition) avec la table, le serveur, l'attente, **Fait** et **Reporter** (5, 10 ou 15 min). Sur le plan de salle, un badge indique l'action à faire sur la table concernée et un contour rouge signale le retard ; les initiales du serveur apparaissent sur la table.

Dans une commande, l'onglet **Service** montre la prochaine action, le serveur responsable (modifiable), les étapes du parcours (fait, ignoré, non nécessaire, avec raison) et la chronologie de la table. Réglages dans **Paramètres → Suivi de service** : activation, délais, son et vibration, rappels au serveur ou à toute l'équipe, étapes du parcours.

## 4. Cuisine

**Écran cuisine** `/kds` par poste (cuisine, bar…) : un seul geste par bon, **Prêt** quand le plat est fait (rien à valider à la réception), puis **Terminé** quand il est parti ; articles cochables un à un (le dernier coché passe le bon à Prêt), retour en préparation possible, temps écoulé avec alertes, rappel d'un ticket, bip à l'arrivée. Les statuts remontent sur la salle (« plats prêts »). Les bons cuisine s'impriment aussi (navigateur ou imprimante configurée).

**Alerte « plat prêt » sur le téléphone** : chaque serveur peut activer les notifications push sur son appareil (bouton cloche en haut du portail Commande, ou « Alertes plat prêt » dans le menu de la caisse). Dès que la cuisine passe un ticket à **Prêt**, le serveur de la table reçoit une notification (table, plats à apporter), même l'écran éteint ou l'application en arrière-plan ; une commande comptoir ou à emporter sans serveur abonné prévient toute l'équipe abonnée. La cuisine n'est jamais notifiée de son propre geste, et un écran ManaResto déjà au premier plan affiche son bandeau « Prêt à servir » au lieu d'une notification. Sur iPhone et iPad (iOS 16.4 ou plus récent), l'application doit être installée (Partager → Sur l'écran d'accueil) et ouverte depuis l'écran d'accueil. Un appui sur la notification ouvre la commande. **« Notifications refusées sur cet appareil »** : le téléphone a dit non (appui sur « Ne pas autoriser », ou interrupteur coupé) ; la cloche ouvre alors la marche à suivre : iPhone → Réglages → Notifications → ManaResto → Autoriser les notifications ; Android → cadenas à côté de l'adresse ou Réglages → Applications → ManaResto → Notifications ; puis « Réessayer ». Si ManaResto n'apparaît pas dans Réglages → Notifications, supprimer l'icône de l'écran d'accueil, la réinstaller depuis Safari, l'ouvrir depuis l'icône et toucher la cloche : l'iPhone pose la question. Cette fonction nécessite les clés VAPID sur le serveur (voir `docs/DEPLOIEMENT.md`).

## 5. Stocks et achats

**Stocks & achats** : ingrédients (unité, seuil, coût moyen), recettes par produit (coût matière, marge), **décrémentation automatique à l'envoi en cuisine**, inventaires (écart valorisé), pertes et casse tracées, fournisseurs et bons de commande (envoi, réception partielle ou totale, entrées en stock), suggestions de commande, **rupture automatique** en caisse quand un ingrédient critique est épuisé, rapport (consommation, achats, pertes, food cost).

## 6. Personnel

**Personnel** : fiches employés (coût horaire, PIN de pointage), planning hebdomadaire, **pointeuse** `/pos/clock` (arrivée, pause, reprise, départ), corrections manager, heures et coût du personnel, coût matière + personnel sur le tableau de bord.

## 7. Statistiques, rapports et exports

**Statistiques** (menu Statistiques) : une page complète sur la période de votre choix (7 jours, 30 jours, ce mois, mois dernier, 90 jours ou dates libres) avec comparaison à la période précédente : faits marquants en langage clair, chiffre d'affaires, tickets, couverts, panier moyen, marge brute, ratio coût matière, coût du personnel et coût matière + personnel, courbe par jour, jours de semaine et heures de pointe, catégories, top produits, serveurs, moyens de paiement et types de vente, temps de préparation en cuisine, durée moyenne d'un repas, réservations et no-show, clients connus et fidèles, part des ventes en ligne.


**Tableau de bord** (jour) et **Rapports & exports** (période) : synthèse et comparaison, par jour, heure, catégorie, produit, serveur, moyen de paiement, type de vente. Exports **CSV, Excel, PDF** : rapport, ventes par produit, commandes, personnel, **export comptable** (journal de caisse, ventes par taux de TVA, encaissements, écritures).

## 8. Digital

**Digital : QR, en ligne, borne** :
- **QR code à table** : menu seul, menu + appel serveur, commande validée par le personnel, ou commande directe. QR codes imprimables par table.
- **Commande en ligne** `/commander/<entreprise>/<établissement>` : click & collect et livraison (zones, frais, minimum), acceptation en caisse (onglet « En ligne & borne »), suivi client `/suivi/<code>`.
- **Borne** `/kiosk` sur un appareil enregistré de type Borne.
- **Fidélité** : points au paiement, récompense en remise, fiche client en caisse.
- **Réservations** : formulaire public `/reserver/…`, écran caisse (confirmer, arrivée, installer, no-show).
- **Site du restaurant** `/site/<entreprise>/<établissement>` : page publique propre à votre restaurant (présentation, horaires, adresse avec itinéraire, téléphone, photos, réseaux sociaux, menu en ligne avec prix) et boutons Commander, Réserver, Appeler. Réglages dans Digital → « Site du restaurant » (accroche, description, image de couverture, logo, photos, couleur, afficher le menu / les prix). Le site existe dès la création du compte ; partagez son adresse ou faites-y pointer votre nom de domaine.
- Interfaces clients en français, anglais et reo tahiti (site du restaurant : `?lang=en` ou `?lang=ty`).

## 9. Intégrations

**Imprimantes & tiroir-caisse** (`/admin/hardware`) :

- **Imprimantes connectées** Epson (Server Direct Print) ou Star (CloudPRNT) : l'imprimante vient chercher ses tickets sur ManaResto toutes les quelques secondes ; rien à installer, fonctionne avec la version en ligne et en Wi-Fi. ManaResto donne l'adresse à saisir dans la page de configuration de l'imprimante ; l'état « En ligne » s'affiche ensuite.
- **Imprimante Wi-Fi ou réseau du restaurant** (toute imprimante thermique ESC/POS : Epson, Xprinter, Bixolon, Star…) : on la relie au Wi-Fi ou à la box (WPS ou utilitaire du fabricant), on note son adresse IP (page d'état), et un petit programme gratuit, l'**agent d'impression** (`tools/print-agent`), tourne sur un ordinateur ou un Raspberry Pi du restaurant : la caisse lui envoie les tickets, il les transmet à l'imprimante. Un seul agent sert toutes les imprimantes Wi-Fi ; l'assistant « Ajouter une imprimante » détaille la marche à suivre. Sans internet, la tablette imprime toujours par ce chemin.
- **Tiroir-caisse** : branché (câble RJ11) sur l'imprimante de caisse. Il s'ouvre à chaque encaissement d'un moyen de paiement qui le demande (espèces par défaut, réglable dans Paramètres), à l'ouverture et à la clôture de caisse, et par le bouton « Ouvrir le tiroir » de l'écran Caisse (permission « Ouvrir le tiroir-caisse sans vente », motif enregistré dans le journal d'audit). Un ticket réimprimé n'ouvre jamais le tiroir.
- Avec plusieurs caisses, chaque imprimante peut être attribuée à une caisse.

**Intégrations : API, webhooks, imprimantes, TPE** :
- **Clés API** pour vos partenaires (comptable, site, automatisations) : voir `docs/API-PUBLIQUE.md`.
- **Webhooks** : notification signée à chaque événement (commande clôturée…), test et journal.
- **Imprimantes** : connectées Epson / Star, Wi-Fi ou réseau via l'agent d'impression (`tools/print-agent`), réseau ESC/POS direct (serveur ou boîtier sur place) ou navigateur ; bons cuisine auto-imprimés par poste.
- **TPE** : mode manuel ou passerelle HTTP (bouton « Envoyer au TPE »).

**Multi-sites** : vue consolidée de tous vos établissements, comparaison, copie de catalogue.

## 10. Utilisateurs, rôles et audit

**Utilisateurs** : comptes, rôles (propriétaire, manager, serveur, cuisine, bar, caissier… personnalisables par permission), PIN. **Inviter par e-mail** : saisissez l'adresse, le prénom, le nom et le rôle ; la personne reçoit un lien (valable 7 jours) pour choisir son mot de passe et son PIN, puis entre directement dans l'application. Le lien peut aussi être copié et transmis à la main (WhatsApp, SMS) si l'envoi d'e-mail n'est pas configuré ; « Renvoyer » génère un nouveau lien. **Journal d'audit** : toute action sensible (remise, annulation, correction, paramètres, clés API) est tracée avec l'auteur et le motif.

## 11. Sécurité

Sessions chiffrées par cookie, PIN et mots de passe hachés, tentatives limitées (connexion, PIN, formulaires publics, API), en-têtes de sécurité HTTP, permissions vérifiées côté serveur sur chaque route, isolation stricte par établissement.

## Offre et abonnement

15 jours d'essai gratuits à la création de votre espace, sans carte bancaire. Ensuite 12 000 F CFP par mois avec un engagement de 12 mois pour le programme de base (caisse, salle, cuisine, réservations par téléphone, tickets et rapports du jour), 0 % de commission sur vos ventes et vos commandes en ligne. Les options (stock, digital, équipe, statistiques, hors ligne…) et les services ponctuels (mise en place, formation…) se demandent depuis Gestion → Options. Contact : contact@manaresto.com.

## Compte de démonstration

`demo@manaresto.pf` / `demo1234` (PIN 1234) — établissement « Le Mana Beach ». Manager : PIN 2000, cuisine : 3000, bar : 4000, serveurs : 1001 à 1005.
