/**
 * Images du site vitrine : version AVIF de chaque image WebP de site/assets/img (environ un tiers plus légère),
 * plus une taille intermédiaire de 1280 px pour les grandes photos d'ambiance (écrans d'ordinateur courants).
 * Les pages proposent l'AVIF au navigateur et gardent le WebP pour les anciens navigateurs (<picture>).
 *
 *   node scripts/site-avif.mjs          ne refait que les fichiers manquants ou plus anciens que leur WebP
 *   node scripts/site-avif.mjs --force  refait tout
 */
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const DIR = new URL("../site/assets/img/", import.meta.url).pathname;
const force = process.argv.includes("--force");
// Photos (ambiance, bannière, équipe, lagon) : compression plus forte ; captures d'écran : un peu plus de qualité pour le texte
const isPhoto = (f) => /^(ambiance-|banner-|equipe-|lagon-)/.test(f);
// Grandes photos plein écran : une taille intermédiaire pour les ordinateurs courants (le 1920 reste pour les écrans haute densité)
const INTERMEDIATE = /^(ambiance-[a-z]+|lagon-soir)\.webp$/;

const mtime = async (p) => (await stat(p).catch(() => null))?.mtimeMs ?? 0;
let made = 0, before = 0, after = 0;

for (const f of (await readdir(DIR)).filter((x) => x.endsWith(".webp")).sort()) {
  const src = join(DIR, f);
  if (INTERMEDIATE.test(f)) {
    const mid = join(DIR, f.replace(".webp", "-1280.webp"));
    if (force || (await mtime(mid)) < (await mtime(src))) {
      await sharp(src).resize(1280).webp({ quality: 72, effort: 6 }).toFile(mid);
      made++;
    }
  }
}
for (const f of (await readdir(DIR)).filter((x) => x.endsWith(".webp")).sort()) {
  const src = join(DIR, f);
  const dst = src.replace(/\.webp$/, ".avif");
  if (!force && (await mtime(dst)) >= (await mtime(src))) continue;
  await sharp(src).avif({ quality: isPhoto(f) ? 52 : 60, effort: 6 }).toFile(dst);
  const [a, b] = [(await stat(src)).size, (await stat(dst)).size];
  before += a; after += b; made++;
  console.log(`${f.padEnd(34)} ${String(Math.round(a / 1024)).padStart(4)} Ko → ${String(Math.round(b / 1024)).padStart(4)} Ko`);
}
console.log(made ? `\n${made} fichier(s) · WebP ${Math.round(before / 1024)} Ko → AVIF ${Math.round(after / 1024)} Ko` : "Rien à refaire.");
