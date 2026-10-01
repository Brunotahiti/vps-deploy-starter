import { describe, expect, it } from "vitest";
import { courseColor, mealStage } from "@/lib/meal-stage";

const C = [{ id: "a", name: "APÉRITIFS", sortOrder: 0 }, { id: "e", name: "ENTRÉES", sortOrder: 1 }, { id: "p", name: "PLATS", sortOrder: 2 }, { id: "d", name: "DESSERTS", sortOrder: 3 }];
const it_ = (courseId: string | null, status: string, parentItemId: string | null = null) => ({ courseId, status, parentItemId });

describe("Où en est le repas d'une table", () => {
  it("une étape par suite commandée, dans l'ordre, avec son état", () => {
    const m = mealStage(C, [it_("e", "SERVED"), it_("e", "SERVED"), it_("p", "PREPARING"), it_("p", "SENT"), it_("d", "PENDING"), it_("d", "VOIDED"), it_("p", "PENDING", "x")]);
    expect(m.steps).toEqual([{ name: "ENTRÉES", state: "SERVED" }, { name: "PLATS", state: "COOKING" }, { name: "DESSERTS", state: "PENDING" }]);
    expect(m.current).toEqual({ name: "PLATS", state: "COOKING" }); // les entrées sont servies, les plats en cuisine
  });
  it("un plat prêt passe avant tout : c'est ce qu'il faut apporter", () => {
    const m = mealStage(C, [it_("e", "SENT"), it_("p", "READY")]);
    expect(m.current).toEqual({ name: "PLATS", state: "READY" });
  });
  it("tout servi : dernière suite servie ; rien d'envoyé : pas d'étape en cours", () => {
    expect(mealStage(C, [it_("e", "SERVED"), it_("p", "SERVED")]).current).toEqual({ name: "PLATS", state: "SERVED" });
    expect(mealStage(C, [it_("e", "PENDING"), it_("p", "PENDING")]).current).toBeNull();
    expect(mealStage(C, []).steps).toEqual([]);
  });
  it("suite partiellement servie (une assiette apportée, une autre pas encore partie) : en cours", () => {
    expect(mealStage(C, [it_("p", "SERVED"), it_("p", "PENDING")]).steps[0].state).toBe("COOKING");
  });
  it("couleurs alignées sur la carte", () => {
    expect(courseColor("ENTRÉES")).toBe("#22c55e");
    expect(courseColor("Plats")).toBe("#f97316");
    expect(courseColor("DESSERTS")).toBe("#ec4899");
  });
});
