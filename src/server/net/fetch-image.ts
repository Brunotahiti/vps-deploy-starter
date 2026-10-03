import https from "node:https";
import { assertPublicUrlShape, publicOnlyLookup } from "./public-url";

/**
 * Télécharge une image publique (https) saisie par un restaurateur, sans jamais viser le réseau interne :
 * adresse vérifiée à la connexion (publicOnlyLookup), redirections suivies une à une et revérifiées,
 * taille lue plafonnée, délai global. Renvoie null au moindre doute.
 */
export async function fetchPublicImage(raw: string, opts: { maxBytes?: number; timeoutMs?: number; maxRedirects?: number } = {}): Promise<Buffer | null> {
  const maxBytes = opts.maxBytes ?? 8_000_000;
  const deadline = Date.now() + (opts.timeoutMs ?? 3000);
  let current = raw;
  for (let hop = 0; hop <= (opts.maxRedirects ?? 3); hop++) {
    let url: URL;
    try { url = assertPublicUrlShape(current); } catch { return null; }
    if (url.protocol !== "https:") return null;
    const left = deadline - Date.now();
    if (left <= 0) return null;
    const res = await get(url, left, maxBytes).catch(() => null);
    if (!res) return null;
    if (res.location) { try { current = new URL(res.location, url).toString(); } catch { return null; } continue; }
    return res.body;
  }
  return null;
}

function get(url: URL, timeoutMs: number, maxBytes: number): Promise<{ location?: string; body: Buffer | null }> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: "GET", lookup: publicOnlyLookup, timeout: timeoutMs, headers: { accept: "image/*" } }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) { res.resume(); return resolve({ location: res.headers.location, body: null }); }
      if (status !== 200 || !(res.headers["content-type"] ?? "").startsWith("image/") || Number(res.headers["content-length"] ?? 0) > maxBytes) { res.resume(); return resolve({ body: null }); }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => { size += c.length; if (size > maxBytes) { req.destroy(); resolve({ body: null }); } else chunks.push(c); });
      res.on("end", () => resolve({ body: Buffer.concat(chunks) }));
      res.on("error", reject);
    });
    const timer = setTimeout(() => req.destroy(new Error("Délai dépassé")), timeoutMs); // délai total, pas seulement d'inactivité
    req.on("close", () => clearTimeout(timer));
    req.on("error", reject);
    req.end();
  });
}
