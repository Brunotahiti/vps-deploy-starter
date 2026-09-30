import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiClientError } from "@/lib/api-client";

const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

describe("client API : déballage de l'enveloppe { data }", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("renvoie null quand l'API répond { data: null } (ex. aucune caisse ouverte) — régression MANARESTO-1", async () => {
    vi.stubGlobal("fetch", reply(200, { data: null }));
    await expect(api.get("/api/cash/current")).resolves.toBeNull();
  });
  it("renvoie la donnée, y compris 0, false ou une chaîne vide", async () => {
    vi.stubGlobal("fetch", reply(200, { data: { summary: { cashExpected: 1200 } } }));
    await expect(api.get("/x")).resolves.toEqual({ summary: { cashExpected: 1200 } });
    vi.stubGlobal("fetch", reply(200, { data: 0 }));
    await expect(api.get("/x")).resolves.toBe(0);
    vi.stubGlobal("fetch", reply(200, { data: false }));
    await expect(api.get("/x")).resolves.toBe(false);
  });
  it("transforme une erreur en ApiClientError typée", async () => {
    vi.stubGlobal("fetch", reply(404, { error: { code: "NOT_FOUND", message: "Introuvable" } }));
    await expect(api.get("/x")).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
    await expect(api.get("/x")).rejects.toBeInstanceOf(ApiClientError);
  });
});

import { safeNext } from "@/lib/safe-next";
describe("redirection après connexion", () => {
  it("n'accepte que les chemins internes", () => {
    expect(safeNext("/platform", "/")).toBe("/platform");
    expect(safeNext("https://evil.tld/login", "/")).toBe("/");
    expect(safeNext("//evil.tld", "/")).toBe("/");
    expect(safeNext("/\\evil.tld", "/")).toBe("/");
    expect(safeNext(null, "/pos")).toBe("/pos");
  });
});
