import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { lockedPermissions, OPTION_KEYS, businessTypeSettings } from "@/lib/options";
import { requireOption } from "@/server/auth/context";
import { listOptions, pendingOptionRequests, requestOption, setOptionPrice, setOrganizationOptions } from "@/server/services/options";
import { assertDigitalOption, createOnlineOrder, restaurantSite, tableMenu } from "@/server/services/public";
import { DEMO_ORG_SLUG } from "@/lib/platform";

let base: Awaited<ReturnType<typeof makeTenant>>;
let full: Awaited<ReturnType<typeof makeTenant>>;
const admin = { id: "00000000-0000-4000-8000-000000000000", email: "admin@manaresto.com" };

beforeAll(async () => {
  await resetDb();
  base = await makeTenant("opt-base", { options: [] });
  full = await makeTenant("opt-full");
});

describe("programme de base et options payantes", () => {
  it("une option non débloquée retire ses droits, propriétaire compris ; toutes débloquées : rien n'est retiré", () => {
    const locked = lockedPermissions([]);
    for (const p of ["stock.view", "stock.manage", "staff.manage", "customers.manage", "establishments.manage", "reports.view_global", "audit.view", "accounts.charge", "accounts.manage"]) expect(locked.has(p)).toBe(true);
    for (const p of ["pos.use", "cash.open", "catalog.manage", "reports.view", "settings.manage", "users.manage"]) expect(locked.has(p)).toBe(false); // programme de base
    expect(lockedPermissions(OPTION_KEYS).size).toBe(0);
    expect(OPTION_KEYS).toEqual(["stock", "digital", "team", "stats", "continuity", "ai", "accounts", "advanced"]);
    // Statistiques et continuité ne retirent pas de droit : les écrans et routes vérifient l'option elle-même
    expect(() => requireOption({ options: ["stock"] }, "stats")).toThrow(expect.objectContaining({ code: "OPTION_REQUIRED" }));
    expect(() => requireOption({ options: [] }, "team")).toThrow(expect.objectContaining({ status: 403, code: "OPTION_REQUIRED" }));
    expect(() => requireOption({ options: ["team"] }, "team")).not.toThrow();
  });

  it("le restaurateur voit ses options et demande à en débloquer une ; l'équipe l'active depuis la console", async () => {
    await setOptionPrice("stock", 3000, admin);
    let list = await listOptions(base.org.id);
    expect(list.map((o) => [o.key, o.enabled])).toEqual(OPTION_KEYS.map((k) => [k, false]));
    expect(list.find((o) => o.key === "stock")!.monthly).toBe(3000);
    expect(list.find((o) => o.key === "digital")!.monthly).toBeNull(); // « sur demande »

    const r1 = await requestOption(base.managerActor, "stock");
    const r2 = await requestOption(base.managerActor, "stock");
    expect(r2.id).toBe(r1.id); // une seule demande en attente
    list = await listOptions(base.org.id);
    expect(list.find((o) => o.key === "stock")!.requestedAt).not.toBeNull();
    expect((await pendingOptionRequests()).map((p) => [p.organizationName, p.label])).toEqual([["Org opt-base", "Stock et recettes"]]);
    await expect(requestOption(base.managerActor, "inconnue")).rejects.toMatchObject({ status: 400 });

    await setOrganizationOptions(base.org.id, ["stock", "pas-une-option"], admin);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: base.org.id } })).options).toEqual(["stock"]);
    expect(await pendingOptionRequests()).toEqual([]); // demande close à l'activation
    await expect(requestOption(base.managerActor, "stock")).rejects.toMatchObject({ status: 409 });
    expect(await prisma.auditLog.count({ where: { action: "platform.options", entityId: base.org.id } })).toBe(1);
    await setOrganizationOptions(base.org.id, [], admin);
  });

  it("le restaurant exemple ne fait pas de demande (tout y est déjà ouvert)", async () => {
    const demo = await makeTenant("opt-demo");
    await prisma.organization.update({ where: { id: demo.org.id }, data: { slug: DEMO_ORG_SLUG, options: [] } });
    await expect(requestOption(demo.managerActor, "team")).rejects.toMatchObject({ status: 403 });
    await prisma.organization.update({ where: { id: demo.org.id }, data: { slug: "opt-demo-x" } });
  });

  it("sans l'option Digital : ni site, ni QR à table, ni commande en ligne, ni borne", async () => {
    const t = await prisma.table.findFirstOrThrow({ where: { establishmentId: base.est.id } });
    await expect(restaurantSite(base.org.slug, base.est.slug)).rejects.toMatchObject({ status: 404 });
    await expect(tableMenu(t.qrToken!)).rejects.toMatchObject({ status: 404 });
    await expect(createOnlineOrder(base.org.slug, base.est.slug, { id: crypto.randomUUID(), mode: "PICKUP", name: "Moana", phone: "87000000", email: null, lines: [] })).rejects.toMatchObject({ status: 404 });
    await expect(assertDigitalOption(base.est.id)).rejects.toMatchObject({ status: 403 });
    await expect(assertDigitalOption(full.est.id)).resolves.toBeUndefined();
  });
});

describe("type d'activité", () => {
  it("snack et bar : rappels de service à table coupés par défaut ; restaurant : réglages d'origine", () => {
    expect(businessTypeSettings("snack")).toEqual({ service: { enabled: false } });
    expect(businessTypeSettings("bar")).toEqual({ service: { enabled: false } });
    expect(businessTypeSettings("restaurant")).toEqual({});
  });
});
