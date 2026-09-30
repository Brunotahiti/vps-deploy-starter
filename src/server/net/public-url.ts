import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ApiError } from "@/server/errors";

/*
 * Protection contre les requêtes forcées côté serveur (SSRF) : les URL saisies par les restaurateurs
 * (webhooks) ne doivent jamais viser le serveur lui-même, le réseau Docker ou les adresses internes.
 */

/** Adresse privée, locale, de lien local, réservée ou de métadonnées (IPv4 et IPv6). */
export function isPrivateAddress(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^::ffff:/, "");
  if (isIP(v) === 4) {
    const [a, b] = v.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (isIP(v) === 6) return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb") || v.startsWith("ff");
  return true;
}

/** Contrôle de forme (sans DNS) : http(s), pas d'identifiants, pas d'hôte local ni d'adresse IP privée littérale. */
export function assertPublicUrlShape(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new ApiError(400, "BAD_URL", "URL invalide"); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new ApiError(400, "BAD_URL", "L'URL doit commencer par https://");
  if (url.username || url.password) throw new ApiError(400, "BAD_URL", "URL invalide");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local") || !host.includes(".") && !isIP(host)) throw new ApiError(400, "BAD_URL", "Adresse interne refusée");
  if (isIP(host) && isPrivateAddress(host)) throw new ApiError(400, "BAD_URL", "Adresse interne refusée");
  return url;
}

/** Contrôle complet au moment de l'appel : toutes les adresses résolues doivent être publiques. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  const url = assertPublicUrlShape(raw);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) throw new ApiError(400, "BAD_URL", "Adresse interne refusée");
  return url;
}
