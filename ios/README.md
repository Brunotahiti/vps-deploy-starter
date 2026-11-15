# ManaResto pour iPhone et iPad

Application native SwiftUI de ManaResto, pour iPhone et iPad (iOS 17 ou plus récent). Elle parle à la même API que le site : mêmes comptes, mêmes données, en direct.

## Ce que fait l'app

**En natif, pensé pour le service :**
- **Connexion** par e-mail et mot de passe, ou **restaurant de démonstration** en un geste.
- **Appareil caisse** : une fois l'iPad enregistré, chaque employé touche son prénom et tape son **code PIN**. Pas d'e-mail, pas de mot de passe.
- **Salle** : plan des tables par salle, avec leur état (libre, commande en cours, en cuisine, addition, réservée) et le temps écoulé. On ouvre une table avec son nombre de couverts.
- **Prise de commande** : la carte avec photos, catégories et recherche. Les options se choisissent avant l'ajout (cuisson, accompagnement, suppléments, format), avec les règles obligatoire ou facultatif. Formules, quantités, notes pour la cuisine, envoi en cuisine.
- **Encaissement** : espèces, carte, chèque, virement, titre-restaurant, offert. Paiement en plusieurs fois, par personne, monnaie à rendre. **Reçu par e-mail** au client, sans imprimante. Le tiroir-caisse s'ouvre tout seul pour les espèces, par l'imprimante du restaurant.
- **Comptoir** : nouvelle vente en un geste, ventes en cours.
- **Plat prêt** : notification sur l'iPhone du serveur de la table quand la cuisine a fini, un toucher ouvre la commande.
- **Cuisine** : les bons à préparer avec leur temps d'attente (vert, orange, rouge), article par article, puis « Commencer », « Prêt », « Servi ».
- **Journée** : chiffre d'affaires, tickets, couverts, ticket moyen, ventes par heure, plats les plus vendus, encaissements.
- **Pointeuse** : arrivée, pause, reprise, départ par code PIN.

**Tout le reste** (carte, stock, personnel, réservations, comptabilité, réglages) s'ouvre dans l'app depuis **Plus → Gestion complète**, sans se reconnecter. Les onglets affichés suivent les droits de la personne : un cuisinier ne voit que la cuisine.

## Ouvrir le projet sur un Mac

Il faut un Mac avec **Xcode 16** (gratuit sur le Mac App Store).

```sh
brew install xcodegen      # une seule fois
cd ios
xcodegen                   # crée ManaResto.xcodeproj à partir de project.yml
open ManaResto.xcodeproj
```

Dans Xcode, choisissez un simulateur iPhone ou iPad et appuyez sur ▶︎. Le bouton « Découvrir le restaurant de démonstration » permet de tout essayer sans compte.

Les tests (lecture des vraies réponses du serveur, options, montants) se lancent avec ⌘U. Ils tournent aussi automatiquement sur GitHub à chaque modification du dossier `ios/`, dans le workflow **iOS**.

## Publier sur l'App Store

### 1. Une fois pour toutes
1. Inscrivez-vous au **Apple Developer Program** (99 USD par an) sur developer.apple.com, avec le compte Apple de l'entreprise.
2. Dans **App Store Connect**, menu Apps, créez l'app :
   - Nom : ManaResto, ou un nom libre sur l'App Store.
   - Langue principale : français.
   - Identifiant de bundle : `com.manaresto.caisse`. C'est celui de `project.yml` : changez les deux ensemble si vous en voulez un autre.
   - SKU : `manaresto-ios`.
3. Dans Xcode, onglet **Signing & Capabilities** de la cible ManaResto : cochez « Automatically manage signing » et choisissez votre équipe. Vous pouvez aussi renseigner `DEVELOPMENT_TEAM` dans `project.yml` puis relancer `xcodegen`.

### 2. À chaque version
1. Augmentez `MARKETING_VERSION` (1.0.1…) et `CURRENT_PROJECT_VERSION` (2, 3…) dans `project.yml`, puis relancez `xcodegen`.
2. Dans Xcode, choisissez la destination **Any iOS Device**, puis **Product → Archive**.
3. Dans l'organiseur, faites **Distribute App → App Store Connect → Upload**.
4. Testez la version avec **TestFlight** sur vos iPad et iPhone : invitez l'équipe par e-mail.
5. Dans App Store Connect, remplissez la fiche puis faites **Soumettre pour vérification**. Comptez en général 1 à 3 jours.

### 3. La fiche App Store
- **Catégorie** : Économie et entreprise (déjà déclarée dans l'app).
- **Captures d'écran** : iPhone 6,9 pouces (1320 × 2868) et iPad 13 pouces (2064 × 2752). Faites-les sur le simulateur avec ⌘S, sur le restaurant de démonstration : salle, commande, encaissement, cuisine.
- **Confidentialité** : l'app ne fait aucun pistage et n'utilise aucun outil de publicité ou de statistiques. Dans « Confidentialité de l'app », déclarez les données liées au compte : nom et e-mail de l'utilisateur, et e-mail du client si vous lui envoyez son reçu. Ces données servent au fonctionnement de l'app et ne servent pas au pistage. Le manifeste `PrivacyInfo.xcprivacy` est déjà inclus.
- **Adresse de la politique de confidentialité** : `https://app.manaresto.com/confidentialite`. La page est publique et accessible aussi depuis l'app (écran de connexion et onglet Plus).
- **Chiffrement** : l'app n'utilise que le HTTPS standard. C'est déjà déclaré dans l'app, donc aucune question à l'envoi.

### 4. Notes pour l'équipe de vérification d'Apple
À coller dans « Informations de vérification de l'app » :

> ManaResto est un logiciel de caisse et de gestion vendu aux restaurants, sous forme d'abonnement souscrit directement auprès de nous par les entreprises. L'app sert à leurs employés (règle 3.1.3(c)). Aucun achat n'est proposé dans l'app.
> Pour tout essayer sans compte : sur l'écran de connexion, touchez « Découvrir le restaurant de démonstration ».
> Compte de test : demo@manaresto.pf / demo1234 (code PIN 1234 une fois l'appareil enregistré comme caisse, dans Plus).

Dans l'app, les tarifs, l'offre et les demandes d'options du site sont masqués. Le site reconnaît son navigateur intégré grâce à la mention `ManaRestoApp/` de l'agent utilisateur. Cela évite un refus pour achat hors de l'App Store.

## Organisation du code

```
ios/
  project.yml                 configuration du projet Xcode (XcodeGen)
  ManaResto/
    App/                      point d'entrée, aiguillage connexion / PIN / caisse
    Core/                     client API (cookies de session), modèles, état de session, carte, options, formats
    UI/                       pavé PIN, pastilles, images, bandeau d'erreur
    Features/                 Auth, Floor (salle), Counter (comptoir), Order (commande, options, formules, encaissement),
                              Kitchen (cuisine), Clock (pointeuse), Today (journée), More (Plus, gestion web)
    Resources/                icône, couleurs, manifeste de confidentialité
  ManaRestoTests/             tests unitaires + réponses réelles de l'API (Fixtures/)
```

Serveur par défaut : `https://app.manaresto.com`. Une autre adresse se règle dans « Avancé » sur l'écran de connexion, pour une installation sur votre propre serveur.

## Notifications « plat prêt »
Quand la cuisine passe un plat à « Prêt », le serveur de la table reçoit une notification sur son iPhone, même l'écran éteint. Toucher la notification ouvre la commande. Sans serveur attitré (comptoir, à emporter), toute l'équipe équipée de l'app est prévenue, comme sur le site.

- **Dans l'app** : une invitation « Activer » apparaît sur l'onglet Salle, et le réglage se trouve dans Plus → Plats prêts. L'appareil est rattaché à la personne connectée : en changeant d'utilisateur, il passe au suivant.
- **Dans Xcode** : la capacité **Push Notifications** est déjà déclarée (`ManaResto.entitlements`). Avec la signature automatique, Xcode l'ajoute à l'identifiant de l'app.
- **Sur le serveur** : il faut une clé APNs du compte Apple Developer. Les étapes sont dans `docs/DEPLOIEMENT.md`, section « App iOS : notifications par le service d'Apple ». Sans elle, l'option n'apparaît pas dans l'app.
- **Pour tester** : il faut un vrai iPhone ou iPad, le simulateur ne reçoit pas de notifications APNs. Une app lancée depuis Xcode utilise l'environnement de développement d'Apple, une app TestFlight ou App Store celui de production. Le serveur choisit le bon.

## Pour plus tard
- Encaissement **sur compte client** et **carte cadeau**, aujourd'hui disponibles dans la caisse web (Plus → Caisse complète).
