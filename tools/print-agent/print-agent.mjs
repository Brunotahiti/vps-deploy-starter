#!/usr/bin/env node
/**
 * Agent d'impression ManaResto — à lancer sur un ordinateur (PC, Mac, Raspberry Pi) du restaurant, sur le même
 * réseau (Wi-Fi ou box) que les imprimantes thermiques. Reçoit les tickets ESC/POS depuis la caisse (navigateur)
 * et les transmet à l'imprimante en TCP (port 9100). Un seul agent sert toutes les imprimantes Wi-Fi du restaurant.
 *
 *   node print-agent.mjs --port 9123 --printer 192.168.1.50:9100 [--printer 192.168.1.51] [--token secret]
 *
 * Requête : POST /print  { payloadBase64, host?, port? }
 *   - host/port : l'imprimante visée (adresse privée du réseau du restaurant, ou une adresse donnée par --printer) ;
 *   - sans host : la première imprimante donnée par --printer.
 *   GET /status → { ok, printers } (vérification depuis la caisse).
 * Dans ManaResto : Administration → Imprimantes → « Imprimante Wi-Fi / réseau du restaurant », adresse de l'agent
 * http://<ip-du-pc>:9123/print et adresse IP de l'imprimante.
 */
import http from "node:http";
import net from "node:net";

const argv = process.argv.slice(2);
const opt = (name) => argv.flatMap((a, i) => (a === `--${name}` ? [argv[i + 1]] : [])).filter(Boolean);
const PORT = Number(opt("port")[0] ?? 9123);
const TOKEN = opt("token")[0] ?? null;
/** Imprimantes déclarées au lancement (« hôte » ou « hôte:port », séparées par des virgules ou répétées) */
const PRINTERS = opt("printer").flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean).map(parseTarget);
if (PRINTERS.length === 0) PRINTERS.push({ host: "127.0.0.1", port: 9100 });

export function parseTarget(s) {
  const [host, port] = String(s).split(":");
  return { host, port: Number(port) || 9100 };
}

/** Adresse du réseau local (RFC 1918, lien local, boucle) : l'agent ne sert jamais de relais vers internet. */
export function isLocalHost(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(host));
  if (!m) return /\.local$/i.test(String(host)) || String(host) === "localhost";
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a === 127;
}
const PRINT_PORTS = [9100, 9101, 9102, 515];

/** Cible autorisée : déclarée au lancement, ou adresse locale sur un port d'impression. */
export function resolveTarget(body, printers = PRINTERS) {
  if (!body.host) return printers[0];
  const port = Number(body.port) || 9100;
  if (printers.some((p) => p.host === body.host && p.port === port)) return { host: body.host, port };
  if (isLocalHost(body.host) && PRINT_PORTS.includes(port)) return { host: body.host, port };
  return null;
}

function sendToPrinter(buf, { host, port }) {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host, port });
    const t = setTimeout(() => { s.destroy(); reject(new Error(`imprimante ${host}:${port} injoignable`)); }, 5000);
    s.once("error", (e) => { clearTimeout(t); reject(new Error(`imprimante ${host}:${port} : ${e.message}`)); });
    s.once("connect", () => s.end(buf, () => { clearTimeout(t); resolve(); }));
  });
}

export function createAgent({ printers = PRINTERS, token = TOKEN, log = console } = {}) {
  return http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") return res.writeHead(204).end();
    if (req.method === "GET" && (req.url === "/status" || req.url === "/")) return res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true, agent: "manaresto-print-agent", printers: printers.map((p) => `${p.host}:${p.port}`) }));
    if (req.method !== "POST" || !req.url.startsWith("/print")) return res.writeHead(404).end("ManaResto print agent");
    if (token && req.headers.authorization !== `Bearer ${token}`) return res.writeHead(401).end("unauthorized");
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 2_000_000) req.destroy(); });
    req.on("end", async () => {
      try {
        const data = JSON.parse(body || "{}");
        if (!data.payloadBase64) throw new Error("payloadBase64 manquant");
        const target = resolveTarget(data, printers);
        if (!target) { res.writeHead(403, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: false, error: "imprimante refusée : adresse hors du réseau du restaurant" })); return; }
        await sendToPrinter(Buffer.from(data.payloadBase64, "base64"), target);
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true, printer: `${target.host}:${target.port}` }));
        log.log(new Date().toISOString(), `ticket imprimé sur ${target.host}:${target.port}`, data.payloadBase64.length, "octets (base64)");
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: false, error: e.message }));
        log.error(new Date().toISOString(), "échec :", e.message);
      }
    });
  });
}

// Lancé directement (pas importé par un test) : écoute sur le port demandé
if (process.argv[1] && /print-agent\.mjs$/.test(process.argv[1])) {
  createAgent().listen(PORT, () => console.log(`Agent d'impression ManaResto : http://0.0.0.0:${PORT}/print → imprimante(s) ${PRINTERS.map((p) => `${p.host}:${p.port}`).join(", ")} (toute imprimante du réseau local acceptée)`));
}
