/**
 * Boîtier de secours ManaResto : programme principal du mini-PC (lancé par bootstrap.mjs, voir README).
 *
 *   1. base du boîtier créée / mise à jour (migrations de la version installée) ;
 *   2. application ManaResto lancée en mode boîtier, accessible seulement depuis la machine ;
 *   3. adresse HTTPS : le cloud fait pointer <id>.box.manaresto.com vers le mini-PC et fournit le certificat
 *      (renouvelé un mois avant l'échéance) ; sans HTTPS configuré, le boîtier répond en HTTP ;
 *   4. passerelle sur 443 (et redirection depuis 80) : relais vers le cloud, relais local pendant les coupures ;
 *   5. mise à jour automatique : quand la version du cloud change (relais en cours, rien en attente), la nouvelle
 *      version est téléchargée, installée à côté, puis le boîtier redémarre dessus (Docker le relance).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { createGateway } from "./gateway.mjs";
import { applyMigrations } from "./migrate.mjs";
import { isPrivateIpv4 } from "./net.mjs";

export const RELEASE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const VERSION = path.basename(RELEASE_DIR);
const RENEW_BEFORE_MS = 30 * 86400_000;
const log = (...a) => console.log(new Date().toISOString(), ...a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Interfaces virtuelles (Docker, VPN…) : jamais l'adresse du mini-PC sur le réseau du restaurant */
const VIRTUAL = /^(docker|br-|veth|virbr|cni|flannel|cali|tun|tap|wg|tailscale|zt|lxc|vmnet|vboxnet)/;

/**
 * Adresse du mini-PC sur le réseau du restaurant : LAN_IP, sinon l'adresse privée d'une vraie interface
 * (câble ou Wi-Fi), de préférence en 192.168.x puis 10.x (réseaux des box), 172.16-31.x en dernier.
 */
export function detectLanIp(env = process.env, interfaces = os.networkInterfaces()) {
  if (env.LAN_IP) return env.LAN_IP;
  const rank = (ip) => (ip.startsWith("192.168.") ? 0 : ip.startsWith("10.") ? 1 : 2);
  const found = [];
  for (const [name, list] of Object.entries(interfaces)) {
    if (VIRTUAL.test(name)) continue;
    for (const a of list ?? []) if (a.family === "IPv4" && !a.internal && isPrivateIpv4(a.address)) found.push(a.address);
  }
  return found.sort((a, b) => rank(a) - rank(b))[0] ?? "";
}

function cloudCall(c, method, url, body) {
  return fetch(new URL(url, c.cloudUrl), {
    method,
    headers: { authorization: `Bearer ${c.boxToken}`, "content-type": "application/json", "x-box-lan-ip": c.lanIp ?? "", "x-box-version": VERSION },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(method === "POST" && url.includes("certificate") ? 300_000 : 120_000),
  });
}

/** Télécharge et installe une version à côté de la version en service ; `current` pointe ensuite dessus. */
export async function installRelease(c) {
  const res = await cloudCall(c, "GET", "/api/box/release");
  if (!res.ok || !res.body) throw new Error(`téléchargement de la version : ${res.status}`);
  const id = (res.headers.get("x-box-release") || `v${Date.now()}`).replace(/[^\w.-]/g, "");
  const releases = path.join(c.dataDir, "releases");
  fs.mkdirSync(releases, { recursive: true });
  const target = path.join(releases, id);
  if (!fs.existsSync(path.join(target, "box/box.mjs"))) {
    const archive = path.join(releases, `${id}.tgz.part`);
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(archive));
    const partial = `${target}.partial`;
    fs.rmSync(partial, { recursive: true, force: true });
    fs.mkdirSync(partial, { recursive: true });
    await new Promise((resolve, reject) => {
      const tar = spawn("tar", ["-xzf", archive, "-C", partial], { stdio: "inherit" });
      tar.on("error", reject);
      tar.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`décompression : ${code}`))));
    });
    fs.rmSync(archive, { force: true });
    if (!fs.existsSync(path.join(partial, "box/box.mjs"))) throw new Error("version incomplète");
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(partial, target);
  } else {
    await res.body.cancel().catch(() => {});
  }
  // Bascule atomique du lien « current »
  const link = path.join(c.dataDir, "current");
  const tmp = `${link}.${process.pid}`;
  fs.rmSync(tmp, { force: true });
  fs.symlinkSync(path.join("releases", id), tmp);
  fs.renameSync(tmp, link);
  // Seules la version installée et celle en service sont gardées
  for (const name of fs.readdirSync(releases)) if (name !== id && name !== VERSION) fs.rmSync(path.join(releases, name), { recursive: true, force: true });
  return id;
}

/** Certificat gardé sur le boîtier (clé, certificat, adresse, échéance) ou null. */
export function readTls(dataDir) {
  const dir = path.join(dataDir, "tls");
  try {
    const cert = fs.readFileSync(path.join(dir, "cert.pem"), "utf8");
    const key = fs.readFileSync(path.join(dir, "key.pem"), "utf8");
    const hostname = fs.readFileSync(path.join(dir, "host"), "utf8").trim();
    return { cert, key, hostname, notAfter: new Date(new X509Certificate(cert).validTo) };
  } catch {
    return null;
  }
}

function writeTls(dataDir, { cert, key, hostname }) {
  const dir = path.join(dataDir, "tls");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, "key.pem"), key, { mode: 0o600 });
  fs.writeFileSync(path.join(dir, "cert.pem"), cert, { mode: 0o600 });
  fs.writeFileSync(path.join(dir, "host"), hostname);
}

/** Certificat valide encore un mois, sinon nouveau certificat demandé au cloud (le précédent reste en cas d'échec). */
export async function ensureCertificate(c) {
  const current = readTls(c.dataDir);
  if (current && current.notAfter.getTime() - Date.now() > RENEW_BEFORE_MS) return current;
  try {
    const res = await cloudCall(c, "POST", "/api/box/certificate", {});
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
    writeTls(c.dataDir, json.data);
    log(`[boîtier] certificat HTTPS obtenu pour ${json.data.hostname} (jusqu'au ${json.data.notAfter})`);
    return readTls(c.dataDir);
  } catch (err) {
    log(`[boîtier] certificat HTTPS indisponible : ${err.message}`);
    return current;
  }
}

async function registerAddress(c) {
  if (!c.lanIp) return null;
  try {
    const res = await cloudCall(c, "POST", "/api/box/address", { lanIp: c.lanIp });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
    return json.data.hostname;
  } catch (err) {
    log(`[boîtier] adresse non enregistrée : ${err.message}`);
    return null;
  }
}

async function waitFor(fn, ms, what) {
  const end = Date.now() + ms;
  for (;;) {
    try { return await fn(); } catch (err) { if (Date.now() > end) throw new Error(`${what} : ${err.message}`); }
    await wait(2000);
  }
}

export async function runBox(env = process.env) {
  for (const k of ["CLOUD_URL", "BOX_TOKEN", "BOX_SECRET", "DATABASE_URL"]) if (!env[k]) throw new Error(`Variable ${k} manquante`);
  const c = { cloudUrl: env.CLOUD_URL, boxToken: env.BOX_TOKEN, boxSecret: env.BOX_SECRET, dataDir: env.DATA_DIR || "/data", lanIp: detectLanIp(env) };
  const appPort = Number(env.APP_PORT || 3080);
  log(`[boîtier] version ${VERSION}, adresse locale ${c.lanIp || "inconnue"}`);

  // 1. Base du boîtier
  await waitFor(() => applyMigrations({ databaseUrl: env.DATABASE_URL, dir: path.join(RELEASE_DIR, "prisma/migrations"), log }), 120_000, "base du boîtier injoignable");

  // 3. Adresse et certificat (avant l'application : son adresse publique en dépend)
  const hostname = await registerAddress(c);
  let tls = await ensureCertificate(c);
  const publicUrl = tls ? `https://${tls.hostname}` : `http://${c.lanIp || "localhost"}`;

  // 2. Application en mode boîtier, seulement sur la machine
  let leaving = false;
  // La clé du boîtier reste dans la passerelle : l'application n'en a pas besoin
  const { BOX_TOKEN: _token, ...appEnv } = env;
  const app = spawn(process.execPath, ["server.js"], {
    cwd: RELEASE_DIR,
    stdio: "inherit",
    env: { ...appEnv, NODE_ENV: "production", BOX_MODE: "1", PORT: String(appPort), HOSTNAME: "127.0.0.1", PUBLIC_URL: publicUrl, EMAIL_TRANSPORT: "memory" },
  });
  app.on("exit", (code) => { if (!leaving) { log(`[boîtier] application arrêtée (${code}) : redémarrage`); process.exit(1); } });
  await waitFor(async () => { const r = await fetch(`http://127.0.0.1:${appPort}/api/health`); if (!r.ok) throw new Error(String(r.status)); }, 120_000, "application du boîtier");

  // 4. Passerelle
  let updating = false;
  const gw = createGateway({
    cloudUrl: c.cloudUrl, localUrl: `http://127.0.0.1:${appPort}`, dataDir: path.join(c.dataDir, "gateway"),
    boxToken: c.boxToken, boxSecret: c.boxSecret, lanIp: c.lanIp, version: VERSION,
    syncEvery: Number(env.SYNC_EVERY_MS || 30_000), healthEvery: Number(env.HEALTH_EVERY_MS || 5000),
    tls: tls ? { key: tls.key, cert: tls.cert } : undefined,
    extraStatus: () => ({ hostname: tls?.hostname ?? hostname, https: !!tls, certificateUntil: tls?.notAfter.toISOString() ?? null, lanIp: c.lanIp }),
    onRelease: (id) => { if (id && id !== VERSION && !updating) update(id).catch((err) => { updating = false; log(`[boîtier] mise à jour impossible : ${err.message}`); }); },
  });
  const httpsPort = Number(env.HTTPS_PORT || 443), httpPort = Number(env.HTTP_PORT || 80);
  await gw.listen(tls ? httpsPort : httpPort, env.HOST || "0.0.0.0");
  let redirect = null;
  if (tls) {
    // HTTP → adresse HTTPS du boîtier
    redirect = http.createServer((req, res) => { res.writeHead(301, { location: `https://${tls.hostname}${tls && httpsPort !== 443 ? `:${httpsPort}` : ""}${req.url}` }); res.end(); });
    redirect.listen(httpPort, env.HOST || "0.0.0.0");
  }
  log(`[boîtier] prêt : ${tls ? `https://${tls.hostname}` : `http://${c.lanIp}:${httpPort}`}`);

  // Adresse locale (DHCP) vérifiée chaque heure ; certificat chaque jour
  const timers = [
    setInterval(async () => { const ip = detectLanIp(env); if (ip && ip !== c.lanIp) { c.lanIp = ip; await registerAddress(c); } }, 3600_000),
    setInterval(async () => {
      const next = await ensureCertificate(c);
      if (tls && next && next.cert !== tls.cert) { gw.server.setSecureContext({ key: next.key, cert: next.cert }); tls = next; }
    }, 86400_000),
  ];

  async function stop(code) {
    leaving = true;
    timers.forEach(clearInterval);
    redirect?.close();
    await gw.close().catch(() => {});
    app.kill("SIGTERM");
    await Promise.race([new Promise((r) => app.once("exit", r)), wait(10_000)]);
    process.exit(code);
  }

  // 5. Mise à jour : seulement en relais, sans saisie en attente (la passerelle ne l'annonce qu'après une copie réussie)
  async function update(id) {
    if (gw.state.mode !== "relay" || gw.store.outbox.length) return;
    updating = true;
    log(`[boîtier] nouvelle version ${id} : téléchargement`);
    const installed = await installRelease(c);
    if (installed === VERSION) { updating = false; return; }
    log(`[boîtier] version ${installed} installée : redémarrage`);
    await stop(0);
  }

  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { stop(0); });
  return { gw, app, stop };
}
