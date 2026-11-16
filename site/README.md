# Site vitrine ManaResto (www.manaresto.com)

Pages statiques servies par nginx (voir `docker-compose.yml`, service `site`). Aucune dépendance, aucun build.

- `index.html` — page d'accueil (landing). `mentions-legales.html`, `confidentialite.html`, `conditions.html` — pages légales, remplies depuis `config.js`.
- `config.js` — **informations commerciales et légales** (offre, coordonnées, WhatsApp, mentions). Les champs vides sont masqués.
- `testimonials.js` — témoignages clients réels et vidéo d'un service réel ; la section « confiance » reste masquée tant que les deux sont vides. N'y mettre que du contenu vérifié et autorisé.
- `assets/img/` — captures réelles de l'application (WebP, avec une version légère `-640` pour les petits écrans), refaites par `scripts/site-screenshots.mjs` ; après une mise à jour, augmenter le `?v=` des images dans `index.html`. Chaque capture s'agrandit au clic (visionneuse de `script.js`, attributs `data-zoom`, `data-title`, `data-text`). `banner-iaorana.jpg` (bannière « Iaorana et Maeva ») et `logo.png` (logo officiel) sont à déposer ici : le site les affiche automatiquement s'ils existent.
- `robots.txt`, `sitemap.xml` — référencement. Ajouter chaque nouvelle page au sitemap.

## Photos d'ambiance des pages par activité

`assets/img/ambiance-<activité>.webp` (1920 px) et `-900.webp` (téléphone) : photos d'ambiance polynésienne derrière le titre des six pages par activité (restaurant, roulotte, snack, bar, commande en ligne, gestion). Ce sont des **illustrations générées par IA avec Higgsfield** (modèle GPT Image 2.6) : elles ne montrent ni de vrais clients ni de vrais restaurants, et ne servent qu'à l'ambiance. L'en-tête de ces pages ne montre que la photo, sans capture posée dessus : les vraies captures de l'application sont présentées plus bas dans chaque page. Les photos s'affichent avec `class="hero page-hero has-photo"` et un élément `<picture class="hero-photo">` (styles en fin de `styles.css`). Pour en changer une, remplacer les deux fichiers sous le même nom.

Sur l'**accueil**, ces mêmes photos illustrent la section « Pour chaque établissement » : une carte par activité, qui mène à sa page, en carrousel horizontal sur téléphone. Deux autres illustrations générées de la même façon complètent l'accueil : `equipe-tahiti.webp` (équipe d'un restaurant polynésien, section « Pensé à Tahiti ») et `lagon-soir.webp` (terrasse sur le lagon au soir, fond de l'appel final).

## Images rapides (AVIF)

Chaque image WebP de `assets/img/` a une version **AVIF** (environ un tiers plus légère). Les pages la proposent en priorité dans un `<picture>` (`class="av"`, sans effet sur la mise en page) et gardent le WebP pour les anciens navigateurs. Les grandes photos d'ambiance ont aussi une taille intermédiaire de 1280 px pour les ordinateurs courants ; le 1920 px ne sert qu'aux écrans haute densité.

- Après avoir ajouté ou remplacé une image WebP : `node scripts/site-avif.mjs` (ne refait que ce qui manque ou a changé ; `--force` refait tout). `scripts/site-screenshots.mjs` produit déjà l'AVIF de ses captures.
- Une nouvelle `<img>` dans une page : l'envelopper comme les autres, `<picture class="av"><source type="image/avif" srcset="…avif…" sizes="…">` puis l'`<img>` WebP.
- Image principale de la page (bannière de l'accueil, photo d'en-tête des pages par activité) : chargée en priorité (`fetchpriority="high"`, préchargement de la bannière en AVIF dans l'en-tête de l'accueil). Les autres images ne se chargent qu'à l'approche (`loading="lazy"`).
- Logo : `logo-192.webp` (affiché en 38 px) et `logo-48.png` pour l'icône d'onglet ; `logo.png` (256 px) ne sert plus qu'aux données structurées.
- Les images sont gardées 30 jours par le navigateur (`nginx/default.conf`) : pour une mise à jour visible tout de suite, changer le `?v=` ou le nom du fichier.

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
