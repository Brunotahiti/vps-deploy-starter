/**
 * Captures d'écran des options payantes (visionneuse de Gestion → Options), prises dans le restaurant exemple.
 *
 *   BASE=http://localhost:3000 node scripts/option-screenshots.mjs [option…]
 *
 * Serveur lancé avec la démo à jour (pnpm db:seed) et DEMO_UNLOCKED=1. Écrit public/options/<option>-<n>.webp
 * (1280 × 800) ; les vues téléphone sont posées sur un fond aux couleurs de l'option. Les légendes sont dans
 * src/lib/option-shots.ts : garder le même ordre.
 */
import { chromium, devices } from "@playwright/test";
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = new URL("../public/options/", import.meta.url).pathname;
const W = 1280, H = 800;
const ORG = "demo-mana-beach", EST = "le-mana-beach";
const HIDE = "[data-testid=pending-banner],[data-testid=subscription-banner],[data-testid=install-banner],nextjs-portal{display:none!important}";
// Fond des vues téléphone (dégradé de la tuile de l'option)
const BG = { digital: ["#38bdf8", "#4f46e5"], continuity: ["#fb7185", "#dc2626"], bar: ["#d946ef", "#e11d48"], wine: ["#be123c", "#7f1d1d"], screens: ["#818cf8", "#0284c7"] };

const later = async (p) => { if (await p.getByTestId("pending-later").count()) await p.getByTestId("pending-later").click().catch(() => {}); };
const tab = (name) => async (p) => { await p.getByRole("tab", { name }).first().click(); await p.waitForTimeout(1500); };
const click = (name) => async (p) => { await p.getByRole("button", { name }).first().click(); await p.waitForTimeout(1500); };

/** Hors ligne : une table ouverte et commandée sans internet (articles en attente de synchronisation) */
const offlineOrder = async (p) => {
  await p.getByText("T03", { exact: true }).filter({ visible: true }).first().click(); await p.waitForTimeout(800);
  await p.getByRole("button", { name: "4", exact: true }).click(); await p.waitForTimeout(2000);
  for (const name of ["Ajouter Poisson cru au lait de coco", "Ajouter Tartare de thon"]) { await p.getByRole("button", { name }).first().click(); await p.waitForTimeout(700); }
  await p.waitForTimeout(1200);
};

/** [option, url, { phone?, act?, tv? }] — dans l'ordre des légendes */
const SHOTS = [
  ["stock", "/admin/stock"], ["stock", "/admin/stock/recipes", { act: async (p) => { await p.getByText("Burger Bacon", { exact: true }).first().click(); await p.waitForTimeout(1200); } }], ["stock", "/admin/stock/orders"],
  ["digital", `/site/${ORG}/${EST}`], ["digital", "QR", { phone: true }], ["digital", `/commander/${ORG}/${EST}`, { phone: true }], ["digital", `/reserver/${ORG}/${EST}`, { phone: true }],
  ["team", "/admin/staff/shifts"], ["team", "/admin/staff/entries"], ["team", "/admin/staff/summary"],
  ["stats", "/admin/stats"], ["stats", "/admin/reports"],
  ["continuity", "/pos", { offline: true, act: offlineOrder }], ["continuity", "/admin/hardware"],
  ["ai", "/admin/ai"], ["ai", "/admin/ai", { act: tab("Qualité") }], ["ai", "/admin/ai", { act: tab("Commande proposée") }],
  ["hygiene", "/admin/hygiene"], ["hygiene", "/admin/hygiene", { act: tab("Températures") }], ["hygiene", "/admin/hygiene", { act: tab("Traçabilité") }],
  ["accounts", "/admin/accounts"],
  ["marketing", "/admin/marketing"], ["marketing", "/admin/marketing", { act: tab("Campagnes") }], ["marketing", "/admin/marketing", { act: tab("Avis Google") }],
  ["screens", "SCREEN", { tv: true }], ["screens", "/admin/screens"],
  ["catering", "/admin/catering"],
  ["bar", "/pos/bar"], ["bar", "/pos/bar", { act: tab(/Fiches cocktails/) }], ["bar", "/admin/bar"], ["bar", "/admin/bar", { act: tab("Cave du bar") }], ["bar", "/admin/bar", { act: tab("Rapport du bar") }],
  ["wine", "/admin/wine"], ["wine", "/admin/wine", { act: click(/Fiche : Domaine du Lagon/) }], ["wine", "PAIRING"], ["wine", "/admin/wine", { act: tab("Vin au verre") }], ["wine", "/admin/wine", { act: tab("Carte des vins") }],
  ["advanced", "/admin/establishments"], ["advanced", "/admin/audit"], ["advanced", "/admin/integrations"],
];

const only = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const desk = await browser.newContext({ baseURL: BASE, viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await desk.request.post("/api/auth/login", { data: { email: "demo@manaresto.pf", password: "demo1234" } });
const phone = await browser.newContext({ ...devices["iPhone 13"], baseURL: BASE, deviceScaleFactor: 2 });
const tables = ((await (await desk.request.get("/api/floor")).json()).data?.rooms ?? []).flatMap((r) => r.tables);
const screens = (await (await desk.request.get("/api/screens")).json()).data ?? [];

async function frame(png, key) {
  // Téléphone aux coins arrondis, centré sur un fond dégradé
  const [a, b] = BG[key] ?? ["#14b8a6", "#0f766e"];
  const h = H - 80, img = await sharp(png).resize({ height: h }).toBuffer(), { width: w } = await sharp(img).metadata();
  const mask = Buffer.from(`<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="44" ry="44"/></svg>`);
  const rounded = await sharp(img).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
  const bg = Buffer.from(`<svg width="${W}" height="${H}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/></svg>`);
  return sharp(bg).composite([{ input: rounded, left: Math.round((W - w) / 2), top: 40 }]).png().toBuffer();
}

const count = {};
for (const [key, url, o = {}] of SHOTS) {
  const n = (count[key] = (count[key] ?? 0) + 1);
  if (only.length && !only.includes(key)) continue;
  const ctx = o.phone ? phone : desk;
  const p = await ctx.newPage();
  await p.addInitScript((css) => { document.addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = css; document.head.append(s); }); }, HIDE);
  if (o.tv) await p.setViewportSize({ width: W, height: H });
  let target = url;
  if (url === "QR") target = `/m/${tables.find((t) => !t.order)?.qrToken}`;
  if (url === "SCREEN") target = `/ecran/${screens.find((s) => s.name === "Comptoir")?.token ?? screens[0]?.token}`;
  if (url === "PAIRING") {
    const order = (await (await desk.request.post("/api/orders", { data: { type: "DINE_IN", tableId: tables.find((t) => !t.order)?.id, covers: 2 } })).json()).data;
    const prods = (await (await desk.request.get("/api/products")).json()).data;
    for (const name of ["Poisson cru au lait de coco", "Mahi-mahi sauce vanille"]) { const pr = prods.find((x) => x.name === name); if (pr) await desk.request.post(`/api/orders/${order.id}/items`, { data: { productId: pr.id, quantity: 1 } }); }
    target = `/pos/order/${order.id}`;
    o.cleanup = () => desk.request.post(`/api/orders/${order.id}/cancel`, { data: { reason: "Capture d'écran" } });
  }
  await p.goto(target, { waitUntil: "load" }).catch(() => {});
  await p.waitForTimeout(1800);
  await later(p);
  if (o.offline) { await ctx.setOffline(true); await p.waitForTimeout(2500); }
  if (o.act) await o.act(p).catch((e) => console.log(`  ! ${key}-${n} : ${e.message.split("\n")[0]}`));
  await p.waitForTimeout(600);
  let png = await p.screenshot();
  if (o.offline) {
    // Retour du réseau : la commande prise hors ligne se synchronise, puis elle est annulée (rien ne reste dans la démo)
    await ctx.setOffline(false); await p.waitForTimeout(5000);
    const t = ((await (await desk.request.get("/api/floor")).json()).data?.rooms ?? []).flatMap((r) => r.tables).find((x) => x.name === "T03");
    if (t?.order?.id) await desk.request.post(`/api/orders/${t.order.id}/cancel`, { data: { reason: "Capture d'écran" } });
  }
  if (o.phone) png = await frame(png, key);
  await sharp(png).resize(W, H, { fit: "cover", position: "top" }).webp({ quality: 74 }).toFile(`${OUT}${key}-${n}.webp`);
  console.log(`✓ ${key}-${n}  ${target}`);
  await o.cleanup?.();
  await p.close();
}
await browser.close();
