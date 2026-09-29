import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, SYSTEM_ROLES, hasPermission } from "@/lib/permissions";

describe("rôles système", () => {
  it("un serveur ne peut ni modifier les prix, ni supprimer une vente, ni voir le CA global", () => {
    const p = SYSTEM_ROLES.server.permissions as string[];
    expect(hasPermission(p, "catalog.manage")).toBe(false);
    expect(hasPermission(p, "pos.cancel_order")).toBe(false);
    expect(hasPermission(p, "pos.void_item")).toBe(false);
    expect(hasPermission(p, "reports.view_global")).toBe(false);
    expect(hasPermission(p, "pos.use")).toBe(true);
  });
  it("un manager peut annuler, rembourser, remiser et ouvrir les rapports", () => {
    const p = SYSTEM_ROLES.manager.permissions as string[];
    for (const k of ["pos.cancel_order", "pos.refund", "pos.discount", "reports.view", "audit.view"] as const) expect(hasPermission(p, k)).toBe(true);
    expect(hasPermission(p, "reports.view_global")).toBe(false);
  });
  it("le propriétaire a tout", () => {
    expect(hasPermission(["*"], "establishments.manage")).toBe(true);
    expect(SYSTEM_ROLES.owner.permissions).toBe("*");
  });
  it("toutes les permissions des rôles existent dans le référentiel", () => {
    for (const r of Object.values(SYSTEM_ROLES)) if (r.permissions !== "*") for (const k of r.permissions) expect(ALL_PERMISSIONS).toContain(k);
  });
});
