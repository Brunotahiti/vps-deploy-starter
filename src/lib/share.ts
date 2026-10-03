import { slugify } from "./slug";

/**
 * Adresse de partage du site d'un restaurant : manaresto.com/<adresse> (ex. manaresto.com/le-mana-beach).
 * Le site vitrine (www.manaresto.com) relaie ces adresses à l'application ; ses propres pages gardent la priorité.
 */

/** Mots réservés : pages du site vitrine et de l'application, et noms qui prêteraient à confusion. */
export const RESERVED_SHARE_SLUGS = new Set([
  "admin", "aide", "api", "app", "assets", "blog", "commande", "commander", "conditions", "confidentialite", "contact", "demo", "devis",
  "desabonnement", "ecran", "favicon", "icons", "index", "inscription", "invitation", "kds", "kiosk", "login", "manaresto", "mentions-legales",
  "m", "nginx", "onboarding", "platform", "pos", "presse", "prix", "r", "readme", "reserver", "robots", "salle", "signup", "site", "sitemap",
  "static", "suivi", "support", "tarifs", "test", "www", "404", "500",
  // Chemins servis par l'application sous manaresto.com (fichiers, suivi des erreurs)
  "brand", "fonts", "monitoring", "images", "manifest",
]);

export const SHARE_SLUG_MIN = 3;
export const SHARE_SLUG_MAX = 40;

/** Format : minuscules sans accent, chiffres et tirets simples, 3 à 40 caractères, ni tiret au début ou à la fin. */
export function shareSlugError(slug: string): string | null {
  if (slug.length < SHARE_SLUG_MIN || slug.length > SHARE_SLUG_MAX) return `Entre ${SHARE_SLUG_MIN} et ${SHARE_SLUG_MAX} caractères`;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return "Lettres minuscules sans accent, chiffres et tirets seulement (ex. chez-hina)";
  if (RESERVED_SHARE_SLUGS.has(slug)) return "Cette adresse est réservée : choisissez-en une autre";
  return null;
}

/** Proposition à partir du nom du restaurant (« Chez Hina ! » → « chez-hina »). */
export function suggestShareSlug(name: string) {
  let s = slugify(name).slice(0, SHARE_SLUG_MAX).replace(/-+$/g, "");
  if (s.length < SHARE_SLUG_MIN || RESERVED_SHARE_SLUGS.has(s)) s = `${s || "restaurant"}-resto`.slice(0, SHARE_SLUG_MAX);
  return s;
}

/**
 * Adresse complète (cliquable) et adresse affichée (sans « https://www. »). En production : www.manaresto.com/<adresse>
 * (relayée par le site vitrine) ; ailleurs (tests, poste de développement) : <application>/r/<adresse>.
 */
export function shareBase() {
  if (process.env.SHARE_BASE_URL) return process.env.SHARE_BASE_URL.replace(/\/$/, "");
  const app = process.env.PUBLIC_URL?.replace(/\/$/, "") ?? "";
  return !app || app === "https://app.manaresto.com" ? "https://www.manaresto.com" : `${app}/r`;
}
export const shareUrl = (slug: string) => `${shareBase()}/${slug}`;
export const shareLabel = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "");
