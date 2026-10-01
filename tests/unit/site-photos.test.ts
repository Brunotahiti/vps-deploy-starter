import { describe, expect, it } from "vitest";
import { digitalSettingsSchema } from "@/server/schemas";

const site = (v: Record<string, unknown>) => digitalSettingsSchema.safeParse({ site: v }).success;

describe("Photos du site du restaurant", () => {
  it("accepte une adresse web ou une photo enregistrée dans ManaResto", () => {
    expect(site({ coverUrl: "https://exemple.pf/terrasse.jpg" })).toBe(true);
    expect(site({ coverUrl: "/api/uploads/3f2b8c1e-1d2a-4c5b-9e7f-0a1b2c3d4e5f" })).toBe(true);
    expect(site({ photos: ["/demo/site/plage.webp", "https://exemple.pf/a.jpg"] })).toBe(true);
    expect(site({ coverUrl: "" })).toBe(true);
  });
  it("refuse les adresses détournées", () => {
    expect(site({ coverUrl: "//pirate.example/x.jpg" })).toBe(false);
    expect(site({ coverUrl: "javascript:alert(1)" })).toBe(false);
    expect(site({ photos: ["/a b.jpg"] })).toBe(false);
    expect(site({ facebook: "/api/uploads/x" })).toBe(false); // réseaux sociaux : adresse web uniquement
  });
});
