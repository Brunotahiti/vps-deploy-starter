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
