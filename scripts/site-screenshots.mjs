/**
 * Captures d'écran du site vitrine (site/assets/img), prises dans le restaurant exemple.
 *
 *   BASE=http://localhost:3000 node scripts/site-screenshots.mjs [nom…]
 *
 * Serveur lancé avec une démo neuve (RESEED=1 pnpm db:seed, sans données de test) et DEMO_UNLOCKED=1.
 * Écrit site/assets/img/<nom>.webp : 1280 × 800 pour l'ordinateur, 640 × 1090 pour les vues téléphone (m-…),
 * plus une version légère (<nom>-640.webp, ou -320 pour le téléphone) chargée par les petits écrans.
 * Après une mise à jour, augmenter le ?v= des images dans site/index.html (cache navigateur de 30 jours).
 */
import { chromium, devices } from "@playwright/test";
import sharp from "sharp";

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = new URL("../site/assets/img/", import.meta.url).pathname;
const W = 1280, H = 800;
const ORG = "demo-mana-beach", EST = "le-mana-beach";
const HIDE = "[data-testid=pending-banner],[data-testid=subscription-banner],[data-testid=install-banner],[data-testid=trial-banner],[data-testid=demo-tour],[data-testid=demo-tour-pill],nextjs-portal{display:none!important}";
// Sur ordinateur, la barre des portails cache le bas de l'écran : on la retire des grandes captures
const HIDE_DESK = "[data-testid=portal-dock]{display:none!important}";

const later = async (p) => { if (await p.getByTestId("pending-later").count()) await p.getByTestId("pending-later").click().catch(() => {}); };

const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const desk = await browser.newContext({ baseURL: BASE, viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await desk.request.post("/api/auth/login", { data: { email: "demo@manaresto.pf", password: "demo1234" } });
const phone = await browser.newContext({ ...devices["iPhone 13"], baseURL: BASE, deviceScaleFactor: 2 });
await phone.request.post("/api/auth/login", { data: { email: "demo@manaresto.pf", password: "demo1234" } });

// Table la mieux garnie : l'écran de caisse montre une vraie commande en cours
const tables = ((await (await desk.request.get("/api/floor")).json()).data?.rooms ?? []).flatMap((r) => r.tables);
const busy = tables.filter((t) => t.order).sort((a, b) => (b.order.total ?? 0) - (a.order.total ?? 0))[0];

/** [nom, url, { phone?, act? }] */
const SHOTS = [
  ["order", `/pos/order/${busy?.order?.id}`],
  ["m-floor", "/pos", { phone: true }],
  ["service", "/pos", { act: async (p) => { await p.getByTestId("todo-button").first().click(); await p.waitForTimeout(1200); } }],
  // Les plats : que des vraies photos
  ["online", `/commander/${ORG}/${EST}`, { act: async (p) => { await p.getByRole("button", { name: "Plats", exact: true }).first().click(); await p.waitForTimeout(1200); } }],
  ["floor", "/pos"],
  ["kds", "/kds"],
  ["dashboard", "/admin"],
  ["stats", "/admin/stats"],
  // Pages par activité : comptoir et vente à emporter, écran d'appel, commande en ligne sur téléphone, site du restaurant
  ["takeaway", "/pos/emporter"],
  ["call", "/pos/appel"],
  ["m-online", `/commander/${ORG}/${EST}`, { phone: true, act: async (p) => { await p.getByRole("button", { name: "Plats", exact: true }).first().click(); await p.waitForTimeout(1200); } }],
  ["restosite", `/site/${ORG}/${EST}`],
];

const only = process.argv.slice(2);
for (const [name, url, o = {}] of SHOTS) {
  if (only.length && !only.includes(name)) continue;
  const p = await (o.phone ? phone : desk).newPage();
  await p.addInitScript((css) => { document.addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = css; document.head.append(s); }); }, o.phone ? HIDE : HIDE + HIDE_DESK);
  await p.goto(url, { waitUntil: "load" }).catch(() => {});
  await p.waitForTimeout(2500);
  await later(p);
  if (o.act) await o.act(p).catch((e) => console.log(`  ! ${name} : ${e.message.split("\n")[0]}`));
  await p.waitForTimeout(800);
  const png = await p.screenshot();
  const [w, h] = o.phone ? [640, 1090] : [W, H];
  const full = await sharp(png).resize(w, h, { fit: "cover", position: "top" }).toBuffer();
  await sharp(full).webp({ quality: 78 }).toFile(`${OUT}${name}.webp`);
  await sharp(full).resize(w / 2).webp({ quality: 76 }).toFile(`${OUT}${name}-${w / 2}.webp`);
  console.log(`✓ ${name}  ${url}`);
  await p.close();
}
await browser.close();
