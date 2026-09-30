import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { rateLimit, rateLimitIp, resetRateLimits } from "@/server/rate-limit";

describe("limitation de débit", () => {
  beforeEach(() => resetRateLimits());
  it("laisse passer `limit` appels puis répond 429 avec un délai", () => {
    for (let i = 0; i < 3; i++) rateLimit("k", 3, 1000);
    expect(() => rateLimit("k", 3, 1000)).toThrowError(expect.objectContaining({ status: 429, code: "RATE_LIMITED" }));
    rateLimit("autre", 3, 1000); // clé indépendante
  });
  it("sépare les adresses IP (X-Forwarded-For)", () => {
    const a = new NextRequest("http://x/api", { headers: { "x-forwarded-for": "1.1.1.1, 10.0.0.1" } });
    const b = new NextRequest("http://x/api", { headers: { "x-forwarded-for": "2.2.2.2" } });
    rateLimitIp(a, "s", 1); rateLimitIp(b, "s", 1);
    expect(() => rateLimitIp(a, "s", 1)).toThrow();
    rateLimitIp(a, "autre-scope", 1); // périmètre indépendant
  });
});

import { resolveClientIp, isCloudflare } from "@/server/net/client-ip";
describe("adresse du visiteur derrière Cloudflare", () => {
  const h = (m: Record<string, string>) => (n: string) => m[n] ?? null;
  it("ignore l'adresse falsifiée par le client et lit CF-Connecting-IP quand le pair est Cloudflare", () => {
    expect(isCloudflare("172.70.1.2")).toBe(true);
    expect(resolveClientIp(h({ "x-forwarded-for": "1.2.3.4, 203.0.113.9, 172.70.1.2, 172.18.0.5", "cf-connecting-ip": "203.0.113.9" }))).toBe("203.0.113.9");
  });
  it("accès direct (sans Cloudflare) : le pair réel, pas l'en-tête du client", () => {
    expect(resolveClientIp(h({ "x-forwarded-for": "9.9.9.9, 198.51.100.7", "cf-connecting-ip": "9.9.9.9" }))).toBe("198.51.100.7");
  });
  it("local : repli sur x-real-ip", () => {
    expect(resolveClientIp(h({ "x-real-ip": "127.0.0.1" }))).toBe("127.0.0.1");
    expect(resolveClientIp(h({}))).toBe("local");
  });
});
