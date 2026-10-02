#!/usr/bin/env node
/**
 * Passerelle du boîtier de secours ManaResto (mini-PC du restaurant).
 *
 * Les tablettes du restaurant passent toujours par le boîtier :
 *   - internet fonctionne → tout est relayé au cloud (« relais ») ; le boîtier recopie le restaurant toutes les 30 s ;
 *   - internet coupe      → l'application du boîtier répond à la place du cloud (« local ») ; chaque saisie
 *                           (commande, envoi, encaissement, caisse…) est enregistrée dans une file sur disque ;
 *   - internet revient    → la file est rejouée au cloud, dans l'ordre, au nom de qui a saisi, sans doublon ;
 *                           puis le relais reprend et la copie est rafraîchie.
 *
 * Mêmes identifiants des deux côtés : la passerelle fixe elle-même l'id des commandes, articles, paiements et
 * ouvertures de caisse saisis pendant la coupure (le serveur accepte les ids fournis), et y joint les services
 * créés par le boîtier. Une connexion faite pendant la coupure (PIN) est rejouée aussi : sa session du cloud
 * remplace alors celle du boîtier, pour les opérations rejouées puis sur la tablette. Ni PIN ni mot de passe ne sont
 * gardés : le boîtier ne note que la personne connectée et demande au cloud une session pour elle (clé du boîtier).
 *
 *   node gateway.mjs   (configuration par variables d'environnement, voir README.md)
 */
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

export const SESSION_COOKIE = "mr_session";
const HOP = new Set(["connection", "keep-alive", "proxy-connection", "transfer-encoding", "te", "trailer", "upgrade", "host", "content-length"]);
const isMutating = (m) => !["GET", "HEAD", "OPTIONS"].includes(m);
/** Jamais rejoué au cloud : interrogation des imprimantes, impressions et tiroir (déjà faits sur place), flux, boîtier */
const NO_REPLAY = [/^\/api\/hardware\//, /^\/api\/print(\/|$)/, /^\/api\/kitchen\/tickets\/[^/]+\/print/, /^\/api\/box\//, /^\/api\/auth\/heartbeat/, /^\/api\/realtime/, /^\/api\/auth\/offline-passes/];
/** Requêtes rejouées : en-têtes conservés (le reste est propre à la connexion de la tablette) */
const KEEP = ["cookie", "content-type", "idempotency-key", "x-offline-pass", "x-offline-manager", "user-agent", "accept", "accept-language"];
const MAX_BODY = 25 * 1024 * 1024;
const MAX_ATTEMPTS = 5;

export function cookieValue(header, name) {
  for (const part of String(header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
function replaceCookie(header, name, value) {
  return String(header ?? "").split(";").map((p) => (p.split("=")[0].trim() === name ? ` ${name}=${value}` : p)).join(";").trim();
}
/** Jeton de session posé par une réponse (Set-Cookie mr_session=…), avec sa durée */
export function sessionFromSetCookie(setCookies) {
  for (const c of [].concat(setCookies ?? [])) {
    const m = /^mr_session=([^;]*)/.exec(c);
    if (!m) continue;
    const age = /max-age=(\d+)/i.exec(c);
    return { token: decodeURIComponent(m[1]), maxAge: age ? Number(age[1]) : null };
  }
  return null;
}

/**
 * Ids fixés par la passerelle avant que le boîtier ne traite la saisie : le cloud créera les mêmes au rejeu.
 * Renvoie le corps modifié (ou le corps d'origine).
 */
export function injectIds(method, pathname, body) {
  if (method !== "POST" || !body?.length) return body;
  const rules = [/^\/api\/orders$/, /^\/api\/orders\/[^/]+\/items$/, /^\/api\/cash\/open$/, /^\/api\/orders\/[^/]+\/payments$/];
  if (!rules.some((r) => r.test(pathname))) return body;
  let json;
  try { json = JSON.parse(body.toString("utf8")); } catch { return body; }
  if (!json || typeof json !== "object") return body;
  if (/\/payments$/.test(pathname)) {
    if (!Array.isArray(json.payments)) return body;
    json.payments = json.payments.map((p) => (p && typeof p === "object" && !p.id ? { ...p, id: randomUUID() } : p));
  } else if (!json.id) json.id = randomUUID();
  return Buffer.from(JSON.stringify(json));
}

/** Après la réponse du boîtier : services et heure d'ouverture d'une commande créée pendant la coupure */
export function completeBody(method, pathname, body, localResponse) {
  if (method !== "POST" || pathname !== "/api/orders" || !body?.length || !localResponse?.length) return body;
  try {
    const json = JSON.parse(body.toString("utf8"));
    const order = JSON.parse(localResponse.toString("utf8"))?.data;
    if (!order?.id) return body;
    if (!json.courses && Array.isArray(order.courses) && order.courses.length) json.courses = order.courses.map((c) => ({ id: c.id, name: c.name }));
    if (!json.openedAt && order.openedAt) json.openedAt = order.openedAt;
    return Buffer.from(JSON.stringify(json));
  } catch {
    return body;
  }
}

/** File d'attente sur disque : une ligne par saisie (ajout synchronisé avant de répondre à la tablette) */
function createStore(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(dir, "static"), { recursive: true });
  const f = (n) => path.join(dir, n);
  const readJson = (n, d) => { try { return JSON.parse(fs.readFileSync(f(n), "utf8")); } catch { return d; } };
  const writeJson = (n, v) => {
    const tmp = f(`${n}.tmp`);
    const fd = fs.openSync(tmp, "w", 0o600);
    fs.writeSync(fd, JSON.stringify(v));
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fs.renameSync(tmp, f(n));
  };
  const done = new Set(readJson("done.json", []));
  let lines = [];
  try { lines = fs.readFileSync(f("outbox.jsonl"), "utf8").split("\n").filter(Boolean); } catch {}
  const outbox = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((e) => e && !done.has(e.id));
  const sessions = readJson("sessions.json", {});
  const conflicts = readJson("conflicts.json", []);
  return {
    outbox, sessions, conflicts,
    append(entry) {
      const fd = fs.openSync(f("outbox.jsonl"), "a", 0o600);
      fs.writeSync(fd, `${JSON.stringify(entry)}\n`);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      outbox.push(entry);
    },
    ack(entry) {
      outbox.splice(outbox.indexOf(entry), 1);
      if (outbox.length === 0) {
        // File vide : on repart de fichiers vides (les saisies rejouées contiennent des PIN de connexion)
        fs.writeFileSync(f("outbox.jsonl"), "", { mode: 0o600 });
        done.clear();
      } else done.add(entry.id);
      writeJson("done.json", [...done]);
    },
    saveSessions() {
      const limit = Date.now() - 30 * 86400_000;
      for (const [k, v] of Object.entries(sessions)) if (v.at < limit) delete sessions[k];
      writeJson("sessions.json", sessions);
    },
    conflict(c) {
      conflicts.unshift(c);
      conflicts.splice(200);
      writeJson("conflicts.json", conflicts);
    },
    staticPath: (p) => f(`static/${createHash("sha1").update(p).digest("hex")}`),
    swPath: () => f("sw.js"),
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error("TOO_LARGE")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function createGateway(options) {
  const c = { healthEvery: 5000, syncEvery: 30_000, connectTimeout: 4000, responseTimeout: 30_000, version: "1.0.0", lanIp: "", log: (...a) => console.log(new Date().toISOString(), ...a), ...options };
  const cloud = new URL(c.cloudUrl);
  const local = new URL(c.localUrl);
  const store = createStore(c.dataDir);
  const agents = { cloud: new (cloud.protocol === "https:" ? https : http).Agent({ keepAlive: true, maxSockets: 64 }), local: new http.Agent({ keepAlive: true, maxSockets: 64 }) };
  const state = { mode: "relay", draining: false, syncing: false, lastSync: null, lastSyncError: null, lastCloudOk: null, failures: 0, since: Date.now() };
  const streams = new Set(); // réponses longues (flux temps réel) : coupées au changement de mode pour que la tablette se reconnecte au bon côté
  const timers = [];

  function setMode(mode, why) {
    if (state.mode === mode) return;
    c.log(`[boîtier] ${mode === "local" ? "internet coupé : le boîtier prend le relais" : "internet revenu : relais vers le cloud"} (${why})`);
    state.mode = mode;
    state.since = Date.now();
    for (const s of streams) if (s.target !== mode) s.res.destroy();
  }

  /**
   * Requête vers le cloud ou l'application du boîtier. Rejet avec `delivered: false` si la connexion n'a jamais été
   * établie (la requête n'a pas pu être traitée), `delivered: true` si elle a été coupée après l'envoi.
   */
  async function send(target, req) {
    try {
      return await sendOnce(target, req);
    } catch (err) {
      // Connexion gardée ouverte que le serveur avait déjà fermée : rien n'a été lu, on recommence une fois
      if (err.reused && (err.code === "ECONNRESET" || err.code === "EPIPE")) return sendOnce(target, req);
      throw err;
    }
  }

  function sendOnce(target, { method, url, headers, body, res, capture, stream }) {
    const base = target === "cloud" ? cloud : local;
    const mod = base.protocol === "https:" ? https : http;
    return new Promise((resolve, reject) => {
      let connected = false;
      const up = mod.request({ protocol: base.protocol, hostname: base.hostname, port: base.port || (base.protocol === "https:" ? 443 : 80), method, path: url, headers: { ...headers, ...(body ? { "content-length": body.length } : {}) }, agent: agents[target] });
      const fail = (err, delivered) => { err.delivered = delivered; reject(err); };
      const connectTimer = setTimeout(() => { if (!connected) up.destroy(Object.assign(new Error("CONNECT_TIMEOUT"), { code: "CONNECT_TIMEOUT" })); }, c.connectTimeout);
      up.on("socket", (s) => {
        if (!s.connecting) { connected = true; return; }
        s.once(base.protocol === "https:" ? "secureConnect" : "connect", () => { connected = true; });
      });
      up.setTimeout(stream ? 0 : c.responseTimeout, () => up.destroy(Object.assign(new Error("RESPONSE_TIMEOUT"), { code: "RESPONSE_TIMEOUT" })));
      up.on("error", (err) => { clearTimeout(connectTimer); err.reused = up.reusedSocket; fail(err, connected); });
      up.on("response", (r) => {
        clearTimeout(connectTimer);
        if (!res || capture) {
          const chunks = [];
          r.on("data", (d) => chunks.push(d));
          r.on("end", () => resolve({ status: r.statusCode, headers: r.headers, body: Buffer.concat(chunks) }));
          r.on("error", (e) => fail(e, true));
          return;
        }
        resolve({ status: r.statusCode, headers: r.headers, stream: r });
      });
      up.end(body ?? undefined);
    });
  }

  const forwardHeaders = (req, target, cookie) => {
    const h = {};
    for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k)) h[k] = v;
    if (cookie !== undefined) { if (cookie) h.cookie = cookie; else delete h.cookie; }
    h["x-forwarded-for"] = [req.headers["x-forwarded-for"], req.socket.remoteAddress].filter(Boolean).join(", ");
    h["x-forwarded-proto"] = req.socket.encrypted ? "https" : (req.headers["x-forwarded-proto"] ?? "http");
    h["x-forwarded-host"] = req.headers.host ?? "";
    h.host = target === "cloud" ? cloud.host : (req.headers.host ?? local.host);
    return h;
  };

  /** Session du boîtier déjà remplacée par celle du cloud (connexion faite pendant la coupure, rejouée) */
  function mappedCookie(cookieHeader) {
    const sid = cookieValue(cookieHeader, SESSION_COOKIE);
    const m = sid ? store.sessions[sid] : null;
    return m ? { cookie: replaceCookie(cookieHeader, SESSION_COOKIE, m.token), m } : null;
  }

  function writeHead(req, res, r, target, extraCookies = []) {
    const h = {};
    for (const [k, v] of Object.entries(r.headers)) if (!HOP.has(k)) h[k] = v;
    // Redirection absolue vers le cloud : ramenée sur l'adresse du boîtier
    if (typeof h.location === "string" && h.location.startsWith(cloud.origin)) h.location = h.location.slice(cloud.origin.length) || "/";
    if (extraCookies.length) h["set-cookie"] = [].concat(h["set-cookie"] ?? [], extraCookies);
    h["x-box-mode"] = target === "cloud" ? "relay" : "local";
    res.writeHead(r.status, h);
  }

  async function relay(req, res, body) {
    const mapped = mappedCookie(req.headers.cookie);
    const headers = forwardHeaders(req, "cloud", mapped?.cookie);
    const isStatic = req.method === "GET" && (req.url.startsWith("/_next/static/") || req.url === "/sw.js");
    const isStream = req.url.startsWith("/api/realtime");
    const r = await send("cloud", { method: req.method, url: req.url, headers, body, res, stream: isStream, capture: isStatic });
    state.failures = 0;
    state.lastCloudOk = Date.now();
    // La tablette reçoit la session du cloud qui remplace celle du boîtier
    const extra = mapped && !sessionFromSetCookie(r.headers["set-cookie"])
      ? [`${SESSION_COOKIE}=${encodeURIComponent(mapped.m.token)}; Path=/; HttpOnly; SameSite=Lax${headers["x-forwarded-proto"] === "https" ? "; Secure" : ""}${mapped.m.maxAge ? `; Max-Age=${mapped.m.maxAge}` : ""}`]
      : [];
    writeHead(req, res, r, "cloud", extra);
    if (r.stream) return pipe(r.stream, res, "relay");
    // Fichiers de l'application du cloud gardés sur le boîtier : une page déjà chargée continue de fonctionner pendant la coupure
    if (isStatic && r.status === 200) {
      try { fs.writeFileSync(req.url === "/sw.js" ? store.swPath() : store.staticPath(req.url), r.body); } catch {}
    }
    res.end(r.body);
  }

  function pipe(stream, res, target) {
    const entry = { res, target };
    streams.add(entry);
    res.on("close", () => { streams.delete(entry); stream.destroy(); });
    stream.pipe(res);
  }

  async function serveLocal(req, res, body) {
    const pathname = req.url.split("?")[0];
    const record = isMutating(req.method) && pathname.startsWith("/api/") && !NO_REPLAY.some((r) => r.test(pathname));
    // Le script du service worker reste celui du cloud (sinon la tablette verrait une « mise à jour » à chaque coupure)
    if (req.method === "GET" && pathname === "/sw.js" && fs.existsSync(store.swPath())) {
      res.writeHead(200, { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-cache", "service-worker-allowed": "/", "x-box-mode": "local" });
      return res.end(fs.readFileSync(store.swPath()));
    }
    const sent = record ? injectIds(req.method, pathname, body) : body;
    const headers = forwardHeaders(req, "local");
    const isStream = pathname.startsWith("/api/realtime");
    const capture = record || (req.method === "GET" && pathname.startsWith("/_next/static/"));
    const r = await send("local", { method: req.method, url: req.url, headers, body: sent, res, stream: isStream, capture });
    if (r.stream) { writeHead(req, res, r, "local"); return pipe(r.stream, res, "local"); }
    if (r.status === 404 && pathname.startsWith("/_next/static/")) {
      const file = store.staticPath(req.url);
      if (fs.existsSync(file)) {
        res.writeHead(200, { "content-type": pathname.endsWith(".css") ? "text/css" : pathname.endsWith(".js") ? "application/javascript" : "application/octet-stream", "cache-control": "public, max-age=31536000, immutable", "x-box-mode": "local" });
        return res.end(fs.readFileSync(file));
      }
    }
    if (record && r.status < 400) {
      const h = {};
      for (const k of KEEP) if (req.headers[k]) h[k] = req.headers[k];
      const localSession = sessionFromSetCookie(r.headers["set-cookie"])?.token || null;
      // Connexion (PIN, mot de passe) : seule l'identité de la personne est gardée, jamais ce qu'elle a saisi
      let login = null;
      if (localSession) { try { login = { userId: JSON.parse(r.body.toString("utf8"))?.data?.id ?? null }; } catch { login = { userId: null }; } }
      store.append({ id: randomUUID(), at: new Date().toISOString(), method: req.method, url: req.url, headers: h, body: login ? null : completeBody(req.method, pathname, sent, r.body)?.toString("base64") ?? null, localSession, login, attempts: 0 });
    }
    writeHead(req, res, r, "local");
    res.end(r.body);
  }

  async function handle(req, res) {
    if (req.url === "/__box/status") {
      // Tablettes : l'état du relais ; détail (conflits, copie, adresse) seulement depuis le mini-PC lui-même
      const local = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "");
      const st = status();
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      return res.end(JSON.stringify(local ? st : { mode: st.mode, pending: st.pending, replaying: st.replaying }));
    }
    let body = null;
    try {
      if (isMutating(req.method)) body = await readBody(req);
    } catch {
      res.writeHead(413, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: { code: "TOO_LARGE", message: "Requête trop volumineuse" } }));
    }
    // Pendant la coupure et tant que la file n'est pas rejouée, le boîtier répond (l'ordre des saisies est préservé)
    if (state.mode === "relay" && store.outbox.length === 0) {
      try {
        return await relay(req, res, body);
      } catch (err) {
        if (res.headersSent) return res.destroy();
        if (err.delivered && isMutating(req.method)) {
          // Saisie peut-être traitée par le cloud : la tablette la renverra (même clé d'idempotence), jamais en double
          c.log(`[boîtier] réponse du cloud perdue pour ${req.method} ${req.url} : ${err.code ?? err.message}`);
          return res.destroy();
        }
        cloudDown(err.code ?? err.message);
      }
    }
    try {
      await serveLocal(req, res, body);
    } catch (err) {
      c.log(`[boîtier] application locale injoignable : ${err.code ?? err.message}`);
      if (res.headersSent) return res.destroy();
      res.writeHead(502, { "content-type": "application/json", "x-box-mode": "local" });
      res.end(JSON.stringify({ error: { code: "BOX_UNAVAILABLE", message: "Le boîtier de secours démarre : réessayez dans un instant" } }));
    }
  }

  function cloudDown(why) {
    state.failures += 1;
    setMode("local", why);
  }

  /** Rejoue la file au cloud, dans l'ordre. S'arrête au premier échec de connexion (internet toujours coupé). */
  async function drain() {
    if (state.draining) return;
    state.draining = true;
    try {
      while (store.outbox.length) {
        const e = store.outbox[0];
        const headers = { ...e.headers, host: cloud.host, "x-offline-replay": "1", "x-forwarded-proto": "https" };
        headers["idempotency-key"] ??= `box-${e.id}`;
        const mapped = mappedCookie(headers.cookie);
        if (mapped) headers.cookie = mapped.cookie;
        let body = e.body ? Buffer.from(e.body, "base64") : null;
        let url = e.url;
        if (e.login) {
          // Session du cloud pour la personne connectée sur le boîtier (clé du boîtier ; le terminal suit par son cookie)
          url = "/api/box/sessions";
          body = Buffer.from(JSON.stringify({ userId: e.login.userId }));
          Object.assign(headers, { authorization: `Bearer ${c.boxToken}`, "content-type": "application/json" });
          delete headers["idempotency-key"];
        }
        let r;
        try {
          r = await send("cloud", { method: e.login ? "POST" : e.method, url, headers, body });
        } catch (err) {
          if (!err.delivered) return false;
          e.attempts += 1;
          if (e.attempts < MAX_ATTEMPTS) return false;
          r = { status: 0, body: Buffer.from(err.code ?? err.message) };
        }
        if (r.status >= 500 && ++e.attempts < MAX_ATTEMPTS) return false;
        if (r.status >= 400 || r.status === 0) {
          let message = "";
          try { message = JSON.parse(r.body.toString("utf8"))?.error?.message ?? ""; } catch { message = r.body.toString("utf8").slice(0, 200); }
          c.log(`[boîtier] saisie refusée par le cloud (${r.status}) : ${e.method} ${e.url} ${message}`);
          store.conflict({ at: new Date().toISOString(), savedAt: e.at, method: e.method, url: e.url, status: r.status, message });
        }
        let cloudSession = sessionFromSetCookie(r.headers?.["set-cookie"]);
        if (e.login && r.status === 200) { try { cloudSession = JSON.parse(r.body.toString("utf8")).data; } catch {} }
        if (e.localSession && cloudSession?.token) {
          store.sessions[e.localSession] = { token: cloudSession.token, maxAge: cloudSession.maxAge, at: Date.now() };
          store.saveSessions();
        }
        store.ack(e);
      }
      return true;
    } finally {
      state.draining = false;
    }
  }

  async function checkCloud() {
    let ok = false;
    try {
      const r = await send("cloud", { method: "GET", url: "/api/health", headers: { host: cloud.host, accept: "application/json" } });
      ok = r.status === 200;
    } catch {}
    if (!ok) {
      if (state.mode === "relay" && ++state.failures >= 2) setMode("local", "le cloud ne répond plus");
      return;
    }
    state.lastCloudOk = Date.now();
    state.failures = 0;
    if (store.outbox.length) await drain();
    if (store.outbox.length === 0 && state.mode === "local") {
      setMode("relay", "file rejouée");
      sync().catch(() => {});
    }
  }

  /** Copie du restaurant : cloud → base du boîtier (en relais seulement, rien en attente) */
  async function sync() {
    if (state.syncing || state.mode !== "relay" || store.outbox.length || !c.boxToken) return;
    state.syncing = true;
    try {
      const r = await send("cloud", { method: "GET", url: "/api/box/snapshot", headers: { host: cloud.host, authorization: `Bearer ${c.boxToken}`, "x-box-lan-ip": c.lanIp, "x-box-version": c.version, accept: "application/json" } });
      if (r.status !== 200) throw new Error(`cloud ${r.status} ${r.body.toString("utf8").slice(0, 200)}`);
      const snap = JSON.parse(r.body.toString("utf8")).data;
      const body = Buffer.from(JSON.stringify(snap));
      // Une saisie arrivée pendant le téléchargement (coupure) ne doit pas être écrasée
      if (state.mode !== "relay" || store.outbox.length) return;
      const w = await send("local", { method: "POST", url: "/api/box/import", headers: { host: local.host, "content-type": "application/json", "x-box-secret": c.boxSecret }, body });
      if (w.status !== 200) throw new Error(`boîtier ${w.status} ${w.body.toString("utf8").slice(0, 300)}`);
      state.lastSync = new Date().toISOString();
      state.lastSyncError = null;
      // Nouvelle version sur le cloud : le boîtier se met à jour (rien en attente, relais en cours)
      if (snap.release && c.onRelease) c.onRelease(snap.release);
    } catch (err) {
      state.lastSyncError = err.message;
      c.log(`[boîtier] copie impossible : ${err.message}`);
    } finally {
      state.syncing = false;
    }
  }

  function status() {
    return { mode: state.mode, since: new Date(state.since).toISOString(), pending: store.outbox.length, replaying: state.draining, lastSync: state.lastSync, lastSyncError: state.lastSyncError, lastCloudOk: state.lastCloudOk ? new Date(state.lastCloudOk).toISOString() : null, conflicts: store.conflicts.slice(0, 20), version: c.version, ...(c.extraStatus ? c.extraStatus() : {}) };
  }

  // Au démarrage, une file non vide (coupure en cours au redémarrage) : le boîtier répond jusqu'au rejeu
  if (store.outbox.length) state.mode = "local";

  const server = (c.tls ? https.createServer(c.tls, handle) : http.createServer(handle));
  server.on("clientError", (_e, socket) => socket.destroy());

  return {
    server, state, store, status, sync, drain, checkCloud,
    listen(port, host) {
      timers.push(setInterval(() => { checkCloud().catch(() => {}); }, c.healthEvery));
      timers.push(setInterval(() => { sync().catch(() => {}); }, c.syncEvery));
      checkCloud().then(() => sync()).catch(() => {});
      return new Promise((resolve) => server.listen(port, host, () => resolve(server.address())));
    },
    async close() {
      timers.forEach(clearInterval);
      for (const s of streams) s.res.destroy();
      agents.cloud.destroy();
      agents.local.destroy();
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

// Lancement direct : configuration par variables d'environnement
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const env = process.env;
  for (const k of ["CLOUD_URL", "BOX_TOKEN", "BOX_SECRET"]) if (!env[k]) { console.error(`Variable ${k} manquante`); process.exit(1); }
  const tls = env.TLS_CERT && env.TLS_KEY ? { cert: fs.readFileSync(env.TLS_CERT), key: fs.readFileSync(env.TLS_KEY) } : undefined;
  const gw = createGateway({ cloudUrl: env.CLOUD_URL, localUrl: env.LOCAL_URL ?? "http://127.0.0.1:3000", dataDir: env.DATA_DIR ?? "/var/lib/manaresto-box", boxToken: env.BOX_TOKEN, boxSecret: env.BOX_SECRET, lanIp: env.LAN_IP ?? "", version: env.BOX_VERSION ?? "1.0.0", syncEvery: Number(env.SYNC_EVERY_MS ?? 30_000), healthEvery: Number(env.HEALTH_EVERY_MS ?? 5000), tls });
  const port = Number(env.PORT ?? (tls ? 443 : 8080));
  gw.listen(port, env.HOST ?? "0.0.0.0").then(() => console.log(`[boîtier] passerelle prête sur le port ${port} (cloud : ${env.CLOUD_URL})`));
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => gw.close().finally(() => process.exit(0)));
}
