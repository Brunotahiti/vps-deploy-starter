import { lookup } from "node:dns/promises";
import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from "node:dns";
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
  if (isIP(v) === 6) {
    // IPv4 compatible (::a.b.c.d), NAT64 (64:ff9b::/96) et 6to4 (2002::/16) peuvent viser une adresse IPv4 interne : refusés
    if (/^::(\d+\.){3}\d+$/.test(v) || v.startsWith("64:ff9b:") || v.startsWith("2002:")) return true;
    return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb") || v.startsWith("ff");
  }
  return true;
}

/**
 * Résolution DNS pour http(s).request : l'adresse réellement utilisée pour la connexion est vérifiée
 * (pas de seconde résolution qui pourrait renvoyer une adresse interne entre le contrôle et l'appel).
 */
export function publicOnlyLookup(hostname: string, options: LookupOptions, callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void) {
  dnsLookup(hostname, { ...options, all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err, "");
    const list = addresses as LookupAddress[];
    if (!list.length || list.some((a) => isPrivateAddress(a.address))) return callback(Object.assign(new Error("Adresse interne refusée"), { code: "EPRIVATE" }), "");
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
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
