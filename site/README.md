# Site vitrine ManaResto (www.manaresto.com)

Pages statiques servies par nginx (voir `docker-compose.yml`, service `site`). Aucune dépendance, aucun build.

- `index.html` — page d'accueil (landing). `mentions-legales.html`, `confidentialite.html`, `conditions.html` — pages légales, remplies depuis `config.js`.
- `config.js` — **informations commerciales et légales** (offre, coordonnées, WhatsApp, mentions). Les champs vides sont masqués.
- `testimonials.js` — témoignages clients réels ; la section reste masquée tant que le tableau est vide.
- `assets/img/` — captures réelles de l'application (WebP). `banner-iaorana.jpg` (bannière « Iaorana et Maeva ») et `logo.png` (logo officiel) sont à déposer ici : le site les affiche automatiquement s'ils existent.
- `robots.txt`, `sitemap.xml` — référencement. Ajouter chaque nouvelle page au sitemap.

## Ajouter une page d'atterrissage SEO

Créer `logiciel-caisse-restaurant-tahiti.html` (l'adresse devient `/logiciel-caisse-restaurant-tahiti` grâce à nginx), en réutilisant l'en-tête, le pied de page, `styles.css`, `config.js` et `script.js` d'`index.html`. Chaque page doit avoir un contenu réellement spécifique (pas de texte dupliqué), son propre `<title>`, sa meta description, sa balise canonique et être ajoutée au `sitemap.xml`. Pages prévues :
`/logiciel-caisse-restaurant-tahiti`, `/logiciel-caisse-roulotte-tahiti`, `/logiciel-caisse-snack-tahiti`, `/logiciel-caisse-bar-tahiti`, `/commande-en-ligne-restaurant-tahiti`, `/gestion-restaurant-polynesie`.

## Formulaire de démonstration

Le formulaire envoie `POST /api/demo`, relayé par nginx vers l'application (`/api/public/demo-request`) : enregistrement en base (table `demo_requests`) et e-mail à `contact@manaresto.com` si le SMTP est configuré sur le VPS. Anti-spam : pot de miel, délai minimal, limitation par IP.

## Suivi (tracking)

Aucun outil analytique n'est installé et aucun cookie n'est déposé. Les événements (`cta_trial`, `cta_demo`, `whatsapp`, `demo_form_start`, `demo_form_submit`) sont poussés dans `window.dataLayer` par `script.js` : brancher un outil respectueux du consentement suffit.
