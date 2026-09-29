#!/usr/bin/env node
/**
 * Agent d'impression ManaResto — à lancer sur un PC / Raspberry du restaurant, sur le même réseau
 * que les imprimantes thermiques. Reçoit les tickets ESC/POS depuis la tablette (navigateur) et
 * les transmet à l'imprimante en TCP (port 9100).
 *
 *   node print-agent.mjs --port 9123 --printer 192.168.1.50:9100 [--token secret]
 *
 * Dans ManaResto : Administration → Intégrations → Imprimantes → pilote « Agent », URL http://<ip-du-pc>:9123/print
 * Le navigateur de la caisse POST {payloadBase64} sur cette URL (CORS ouvert). Sur une caisse en HTTPS,
 * autorisez le contenu mixte ou exposez l'agent en HTTPS (reverse proxy local).
 */
import http from "node:http";
import net from "node:net";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => (a.startsWith("--") ? [a.slice(2), arr[i + 1]] : [])).filter((x) => x.length));
const PORT = Number(args.port ?? 9123);
const [PHOST, PPORT] = String(args.printer ?? "127.0.0.1:9100").split(":");
const TOKEN = args.token ?? null;

function sendToPrinter(buf) {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host: PHOST, port: Number(PPORT ?? 9100) });
    const t = setTimeout(() => { s.destroy(); reject(new Error("imprimante injoignable")); }, 5000);
    s.once("error", (e) => { clearTimeout(t); reject(e); });
    s.once("connect", () => s.end(buf, () => { clearTimeout(t); resolve(); }));
  });
}

http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.writeHead(204).end();
  if (req.method !== "POST" || !req.url.startsWith("/print")) return res.writeHead(404).end("ManaResto print agent");
  if (TOKEN && req.headers.authorization !== `Bearer ${TOKEN}`) return res.writeHead(401).end("unauthorized");
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    try {
      const { payloadBase64 } = JSON.parse(body || "{}");
      if (!payloadBase64) throw new Error("payloadBase64 manquant");
      await sendToPrinter(Buffer.from(payloadBase64, "base64"));
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));
      console.log(new Date().toISOString(), "ticket imprimé", payloadBase64.length, "octets (base64)");
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: false, error: e.message }));
      console.error(new Date().toISOString(), "échec :", e.message);
    }
  });
}).listen(PORT, () => console.log(`Agent d'impression ManaResto : http://0.0.0.0:${PORT}/print → imprimante ${PHOST}:${PPORT ?? 9100}`));
