/**
 * Vidéo du site vitrine : un vrai service filmé dans le restaurant exemple (table → commande → cuisine → encaissement).
 *
 *   BASE=http://localhost:3000 FFMPEG=/chemin/vers/ffmpeg node scripts/site-video.mjs
 *
 * Serveur lancé avec une démo neuve (RESEED=1 pnpm db:seed). Écrit site/assets/video/service.mp4 (H.264, accéléré
 * ×1,25, sans le son) et son image d'attente service-poster.webp. ffmpeg doit savoir encoder en libx264.
 */
import { chromium } from "@playwright/test";
import sharp from "sharp";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const BASE = process.env.BASE ?? "http://localhost:3000", FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const OUT = mkdtempSync(join(tmpdir(), "site-video-")), DEST = new URL("../site/assets/video/", import.meta.url).pathname;
const b = await chromium.launch({ args: ["--no-sandbox"] });
const ctx = await b.newContext({ baseURL: BASE, viewport: { width: 1280, height: 800 }, recordVideo: { dir: OUT, size: { width: 1280, height: 800 } } });
await ctx.request.post("/api/auth/login", { data: { email: "demo@manaresto.pf", password: "demo1234" } });
const t0 = Date.now();
const CSS = `[data-testid=pending-banner],[data-testid=subscription-banner],[data-testid=install-banner],[data-testid=portal-dock],[data-testid=demo-tour],[data-testid=demo-tour-pill],nextjs-portal{display:none!important}
#cur{position:fixed;z-index:99999;left:0;top:0;width:26px;height:26px;margin:-4px 0 0 -4px;pointer-events:none;transition:transform .08s linear}
#cur svg{width:26px;height:26px;filter:drop-shadow(0 2px 3px rgb(0 0 0/.45))}
.ripple{position:fixed;z-index:99998;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:rgb(249 124 60/.45);pointer-events:none;animation:rp .5s ease-out forwards}
@keyframes rp{from{transform:scale(.3);opacity:1}to{transform:scale(1.4);opacity:0}}
#cap{position:fixed;z-index:99997;left:50%;bottom:22px;transform:translateX(-50%);max-width:88%;padding:12px 22px;border-radius:16px;background:rgb(8 58 56/.92);color:#fff;font:800 22px/1.25 "Plus Jakarta Sans",system-ui,sans-serif;box-shadow:0 18px 40px -12px rgb(0 0 0/.55);text-align:center;letter-spacing:-.01em}
#cap b{color:#fdba74}`;
await ctx.addInitScript((css) => {
  document.addEventListener("DOMContentLoaded", () => {
    const st = document.createElement("style"); st.textContent = css; document.head.append(st);
    const c = document.createElement("div"); c.id = "cur";
    c.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 2l7 19 2.5-7.5L20 11z" fill="#fff" stroke="#0f172a" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.body.append(c);
    const pos = JSON.parse(sessionStorage.getItem("cur") || "[640,400]"); c.style.transform = `translate(${pos[0]}px,${pos[1]}px)`;
    window.addEventListener("mousemove", (e) => { c.style.transform = `translate(${e.clientX}px,${e.clientY}px)`; sessionStorage.setItem("cur", JSON.stringify([e.clientX, e.clientY])); }, true);
    window.addEventListener("mousedown", (e) => { const r = document.createElement("div"); r.className = "ripple"; r.style.left = e.clientX + "px"; r.style.top = e.clientY + "px"; document.body.append(r); setTimeout(() => r.remove(), 600); }, true);
  });
}, CSS);
const p = await ctx.newPage();
const wait = (ms) => p.waitForTimeout(ms);
const move = async (loc) => { const bb = await loc.boundingBox(); const x = bb.x + bb.width / 2, y = bb.y + bb.height / 2; await p.mouse.move(x, y, { steps: 22 }); await wait(180); };
const tap = async (loc) => { await loc.waitFor({ state: "visible", timeout: 8000 }); await move(loc); await loc.click(); };
const caption = (html) => p.evaluate((h) => { let c = document.getElementById("cap"); if (!c) { c = document.createElement("div"); c.id = "cap"; document.body.append(c); } c.innerHTML = h; }, html);
const marks = {};

await p.goto("/pos", { waitUntil: "load" }); await wait(1500);
marks.start = Date.now() - t0;
await caption("<b>1.</b> Le plan de salle : l'état de chaque table en temps réel"); await wait(2200);
const free = p.locator("button[title='Libre']:visible").first();
const table = (await free.getByTestId("table-name").textContent())?.trim();
await caption(`<b>2.</b> On ouvre la table ${table}…`);
await tap(free); await wait(700);
await tap(p.getByRole("button", { name: "2", exact: true })); await p.waitForURL(/\/pos\/order\//); await wait(1300);
const orderUrl = p.url();
await caption("<b>3.</b> …et on prend la commande, avec les photos des plats");
await tap(p.getByRole("button", { name: "Ajouter Poisson cru au lait de coco" }).first()); await wait(700);
await tap(p.getByRole("button", { name: "Plats", exact: true }).first()); await wait(800);
await tap(p.getByRole("button", { name: "Ajouter Mahi-mahi sauce vanille" }).first()); await wait(700);
await tap(p.getByRole("button", { name: "Boissons", exact: true }).first()); await wait(800);
await tap(p.getByRole("button", { name: "Ajouter Hinano pression 50 cl" }).first()); await wait(1200);
await caption("<b>4.</b> Un geste pour envoyer en cuisine");
await tap(p.getByRole("button", { name: /Envoyer/ }).first()); await wait(600);
const all = p.getByRole("button", { name: "Tout envoyer" });
if (await all.isVisible().catch(() => false)) { await tap(all); }
await wait(1800);
await caption("<b>5.</b> La commande arrive aussitôt sur l'écran cuisine");
await p.goto("/kds", { waitUntil: "load" }); await caption("<b>5.</b> La commande arrive aussitôt sur l'écran cuisine"); await wait(1800);
const tk = p.getByText(new RegExp(`^${table}$`)).first();
if (await tk.isVisible().catch(() => false)) { await move(tk); await wait(1600); }
else await wait(1600);
await caption("<b>6.</b> Retour à la table pour encaisser");
await p.goto(orderUrl, { waitUntil: "load" }); await caption("<b>6.</b> Retour à la table pour encaisser"); await wait(1500);
await tap(p.getByRole("button", { name: /Payer/ }).first()); await wait(900);
await tap(p.getByRole("button", { name: "Carte bancaire" }).first()); await wait(600);
await tap(p.getByRole("button", { name: /Encaisser/ }).first());
await p.getByRole("heading", { name: "Commande soldée" }).waitFor({ timeout: 8000 });
await caption("<b>7.</b> Payé : ticket imprimé, PDF ou envoyé par e-mail"); await wait(2400);
await tap(p.getByRole("button", { name: "Terminer" }).first()); await p.waitForURL(/\/pos$/); await wait(500);
await caption(`La table ${table} est de nouveau libre. <b>Tout le service, dans une seule application.</b>`); await wait(2800);
marks.end = Date.now() - t0;
const video = p.video(); await p.close(); await ctx.close(); await b.close();
const raw = await video.path(), from = (marks.start / 1000).toFixed(1), to = (marks.end / 1000).toFixed(1);
execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-ss", from, "-to", to, "-i", raw, "-vf", "setpts=PTS/1.25,scale=1024:-2:flags=lanczos,fps=25", "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "27", "-profile:v", "high", "-pix_fmt", "yuv420p", "-movflags", "+faststart", `${DEST}service.mp4`]);
const poster = join(OUT, "poster.png");
execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(Number(from) + 7.5), "-i", raw, "-frames:v", "1", "-vf", "scale=1024:-2", poster]);
await sharp(poster).webp({ quality: 78 }).toFile(`${DEST}service-poster.webp`);
console.log(`✓ ${DEST}service.mp4 (${((marks.end - marks.start) / 1250).toFixed(1)} s)`);
