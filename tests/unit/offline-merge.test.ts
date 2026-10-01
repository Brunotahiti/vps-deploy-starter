import { describe, expect, it } from "vitest";
import { aliasesForCreatedOrder, courseAliases, rewriteEntry } from "@/lib/offline/merge";
import type { OutboxEntry } from "@/lib/offline/db";

const LOCAL = "11111111-1111-4111-8111-111111111111";
const SERVER = "22222222-2222-4222-8222-222222222222";
const entry = (url: string, body?: unknown): OutboxEntry => ({ id: "e", method: "POST", url, body, idempotencyKey: "k", createdAt: 0, attempts: 0 });

describe("conflit hors ligne : table déjà ouverte sur un autre appareil", () => {
  it("ne redirige rien quand le serveur a créé la commande demandée", () => {
    expect(aliasesForCreatedOrder({ id: LOCAL, courses: [] }, { id: LOCAL, courses: [] })).toBeNull();
  });

  it("redirige la commande et ses suites vers la commande existante", () => {
    const aliases = aliasesForCreatedOrder(
      { id: LOCAL, courses: [{ id: "c-apero", name: "APÉRITIFS" }, { id: "c-plats", name: "Plats" }, { id: "c-extra", name: "Fromages" }] },
      { id: SERVER, courses: [{ id: "s-plats", name: "PLATS", sortOrder: 2 }, { id: "s-apero", name: "APÉRITIFS", sortOrder: 0 }, { id: "s-entrees", name: "ENTRÉES", sortOrder: 1 }] },
    )!;
    expect(aliases[LOCAL]).toBe(SERVER);
    expect(aliases["c-apero"]).toBe("s-apero"); // même nom
    expect(aliases["c-plats"]).toBe("s-plats"); // même nom, sans tenir compte des majuscules
    expect(aliases["c-extra"]).toBe("s-plats"); // inconnue : même rang (3e)
    expect(courseAliases([{ id: "x", name: "?" }], [])).toEqual({});
  });

  it("réécrit l'adresse et le contenu des opérations en attente", () => {
    const aliases = { [LOCAL]: SERVER, "c-apero": "s-apero" };
    const e = rewriteEntry(entry(`/api/orders/${LOCAL}/items`, { id: "item-1", productId: "p", courseId: "c-apero", modifiers: [] }), aliases);
    expect(e.url).toBe(`/api/orders/${SERVER}/items`);
    expect(e.body).toEqual({ id: "item-1", productId: "p", courseId: "s-apero", modifiers: [] });
    const untouched = entry("/api/orders/autre/items", { productId: "p" });
    expect(rewriteEntry(untouched, aliases)).toBe(untouched);
  });
});
