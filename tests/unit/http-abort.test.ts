import { describe, expect, it, vi } from "vitest";

const captureException = vi.fn();
vi.mock("@sentry/nextjs", () => ({ captureException }));

const { errorResponse, isClientAbort, route } = await import("@/server/http");

/** Erreur levée par Node quand le client coupe la connexion pendant la lecture du corps (node:_http_server abortIncoming). */
function nodeAborted() {
  return Object.assign(new Error("aborted"), { code: "ECONNRESET" });
}

describe("visiteur parti pendant l'envoi : pas une erreur serveur", () => {
  it("connexion coupée reconnue, y compris enveloppée par undici ou par Next", () => {
    expect(isClientAbort(nodeAborted())).toBe(true);
    expect(isClientAbort(new TypeError("terminated", { cause: nodeAborted() }))).toBe(true);
    expect(isClientAbort(Object.assign(new Error("Request aborted"), { code: "UND_ERR_ABORTED" }))).toBe(true);
    expect(isClientAbort(new DOMException("The operation was aborted.", "AbortError"))).toBe(true);
    expect(isClientAbort(new Error("connexion base de données perdue"))).toBe(false);
    expect(isClientAbort(null)).toBe(false);
  });

  it("réponse 499 sans alerte Sentry ; une vraie erreur reste signalée", async () => {
    captureException.mockClear();
    const handler = route(async (req) => { await req.text(); return new Response(null, { status: 204 }); });
    const req = { text: () => Promise.reject(nodeAborted()) } as never;
    const res = await handler(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(499);
    expect(captureException).not.toHaveBeenCalled();
    expect(errorResponse(new Error("panne")).status).toBe(500);
    expect(captureException).toHaveBeenCalledTimes(1);
  });
});
