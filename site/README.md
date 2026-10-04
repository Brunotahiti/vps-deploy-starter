# Site vitrine ManaResto (www.manaresto.com)

Pages statiques servies par nginx (voir `docker-compose.yml`, service `site`). Aucune dépendance, aucun build.

- `index.html` — page d'accueil (landing). `mentions-legales.html`, `confidentialite.html`, `conditions.html` — pages légales, remplies depuis `config.js`.
- `config.js` — **informations commerciales et légales** (offre, coordonnées, WhatsApp, mentions). Les champs vides sont masqués.
- `testimonials.js` — témoignages clients réels et vidéo d'un service réel ; la section « confiance » reste masquée tant que les deux sont vides. N'y mettre que du contenu vérifié et autorisé.
- `assets/img/` — captures réelles de l'application (WebP, avec une version légère `-640` pour les petits écrans), refaites par `scripts/site-screenshots.mjs` ; après une mise à jour, augmenter le `?v=` des images dans `index.html`. Chaque capture s'agrandit au clic (visionneuse de `script.js`, attributs `data-zoom`, `data-title`, `data-text`). `banner-iaorana.jpg` (bannière « Iaorana et Maeva ») et `logo.png` (logo officiel) sont à déposer ici : le site les affiche automatiquement s'ils existent.
- `robots.txt`, `sitemap.xml` — référencement. Ajouter chaque nouvelle page au sitemap.

## Vidéo

`assets/video/service.mp4` (et son image d'attente `service-poster.webp`) : un vrai service filmé dans le restaurant exemple par `scripts/site-video.mjs` (Playwright + ffmpeg). La vidéo démarre sans le son quand elle devient visible ; rien d'automatique si le visiteur préfère moins d'animations.

## Image de partage

`assets/img/og-2026.jpg` (1200 × 630) : aperçu des liens partagés (WhatsApp, Facebook, Messenger). Pour la changer, créer un nouveau nom de fichier (les réseaux sociaux gardent l'ancienne image en cache) et mettre à jour les balises `og:image` et `twitter:image` des pages.

## Pages par activité

`logiciel-caisse-restaurant-tahiti`, `-roulotte-`, `-snack-`, `-bar-`, `commande-en-ligne-restaurant-tahiti`, `gestion-restaurant-polynesie` : chacune avec son texte, ses captures et sa FAQ (données structurées FAQ et fil d'Ariane), reliées depuis l'accueil et le pied de page. Leurs adresses sont réservées côté application (`src/lib/share.ts`) pour qu'aucun restaurant ne les prenne.

## Ajouter une page d'atterrissage SEO

Créer `logiciel-caisse-restaurant-tahiti.html` (l'adresse devient `/logiciel-caisse-restaurant-tahiti` grâce à nginx), en réutilisant l'en-tête, le pied de page, `styles.css`, `config.js` et `script.js` d'`index.html`. Chaque page doit avoir un contenu réellement spécifique (pas de texte dupliqué), son propre `<title>`, sa meta description, sa balise canonique et être ajoutée au `sitemap.xml`. Pages prévues :
`/logiciel-caisse-restaurant-tahiti`, `/logiciel-caisse-roulotte-tahiti`, `/logiciel-caisse-snack-tahiti`, `/logiciel-caisse-bar-tahiti`, `/commande-en-ligne-restaurant-tahiti`, `/gestion-restaurant-polynesie`.

## Formulaire de démonstration

Champs obligatoires : nom du contact, nom de l'établissement et un moyen de contact (téléphone ou e-mail) ; commune, type d'établissement et message sont facultatifs. Le formulaire envoie `POST /api/demo`, relayé par nginx vers l'application (`/api/public/demo-request`) : enregistrement en base (table `demo_requests`) et e-mail à `contact@manaresto.com` si le SMTP est configuré sur le VPS. Anti-spam : pot de miel, délai minimal, limitation par IP.

## Suivi (tracking)

Aucun outil analytique n'est installé et aucun cookie n'est déposé. Les événements (`cta_trial`, `cta_demo`, `whatsapp`, `demo_form_start`, `demo_form_submit`) sont poussés dans `window.dataLayer` par `script.js` : brancher un outil respectueux du consentement suffit.
