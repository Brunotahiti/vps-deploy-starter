import { isIP } from "node:net";
import { isPrivateAddress } from "./public-url";

/*
 * Adresse réelle du visiteur, derrière Cloudflare → Traefik (→ nginx pour le site vitrine).
 * Le PREMIER élément de X-Forwarded-For est fourni par le client (falsifiable) : on part donc de la DROITE,
 * on saute les relais internes (réseau Docker), et on obtient le pair qui a contacté le serveur.
 * Si ce pair est un serveur Cloudflare, l'en-tête CF-Connecting-IP (posé par Cloudflare) donne le visiteur ;
 * sinon (accès direct au serveur), c'est le pair lui-même — impossible à usurper.
 */
const CLOUDFLARE_V4 = ["173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13", "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22"];
const CLOUDFLARE_V6 = ["2400:cb00:", "2606:4700:", "2803:f800:", "2405:b500:", "2405:8100:", "2a06:98c", "2c0f:f248:"];

function ipv4ToInt(ip: string) {
  return ip.split(".").reduce((a, o) => (a << 8) + Number(o), 0) >>> 0;
}
function inCidr(ip: string, cidr: string) {
  const [net, bits] = cidr.split("/");
  const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(net) & mask);
}
export function isCloudflare(ip: string) {
  const v = ip.toLowerCase().replace(/^::ffff:/, "");
  if (isIP(v) === 4) return CLOUDFLARE_V4.some((c) => inCidr(v, c));
  if (isIP(v) === 6) return CLOUDFLARE_V6.some((p) => v.startsWith(p));
  return false;
}

/** Adresse du visiteur à partir des en-têtes (X-Forwarded-For, CF-Connecting-IP). */
export function resolveClientIp(get: (name: string) => string | null): string {
  const chain = (get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter((s) => isIP(s.replace(/^::ffff:/, "")));
  let peer: string | null = null;
  for (let i = chain.length - 1; i >= 0; i--) {
    if (!isPrivateAddress(chain[i])) { peer = chain[i]; break; }
  }
  const cf = get("cf-connecting-ip")?.trim();
  if (peer && isCloudflare(peer) && cf && isIP(cf)) return cf;
  if (peer) return peer;
  // Environnement local / tests (aucun relais public)
  return get("x-real-ip")?.trim() || chain[chain.length - 1] || "local";
}
