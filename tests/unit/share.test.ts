import { afterEach, describe, expect, it } from "vitest";
import { shareBase, shareLabel, shareSlugError, shareUrl, suggestShareSlug } from "@/lib/share";

describe("adresse de partage", () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; });

  it("format : minuscules, chiffres, tirets simples, 3 à 40 caractères, mots réservés refusés", () => {
    expect(shareSlugError("chez-hina")).toBeNull();
    expect(shareSlugError("snack-2")).toBeNull();
    expect(shareSlugError("ab")).toMatch(/Entre 3 et 40/);
    expect(shareSlugError("a".repeat(41))).toMatch(/Entre 3 et 40/);
    expect(shareSlugError("Chez-Hina")).toMatch(/minuscules/);
    expect(shareSlugError("chez--hina")).toMatch(/minuscules/);
    expect(shareSlugError("-chez")).toMatch(/minuscules/);
    expect(shareSlugError("chez hina")).toMatch(/minuscules/);
    expect(shareSlugError("admin")).toMatch(/réservée/);
    expect(shareSlugError("conditions")).toMatch(/réservée/);
  });

  it("proposition à partir du nom du restaurant", () => {
    expect(suggestShareSlug("Chez Hina !")).toBe("chez-hina");
    expect(suggestShareSlug("Fare Ā Mā'ohi")).toBe("fare-a-ma-ohi");
    expect(suggestShareSlug("Pô")).toBe("po-resto");
    expect(suggestShareSlug("Démo")).toBe("demo-resto");
    expect(suggestShareSlug("Le restaurant au nom vraiment très très long du bord de mer").length).toBeLessThanOrEqual(40);
    expect(shareSlugError(suggestShareSlug("Le restaurant au nom vraiment très très long du bord de mer"))).toBeNull();
  });

  it("adresse complète : www.manaresto.com en production, l'application ailleurs", () => {
    process.env.PUBLIC_URL = "https://app.manaresto.com"; delete process.env.SHARE_BASE_URL;
    expect(shareUrl("chez-hina")).toBe("https://www.manaresto.com/chez-hina");
    expect(shareLabel(shareUrl("chez-hina"))).toBe("manaresto.com/chez-hina");
    process.env.PUBLIC_URL = "http://localhost:3000";
    expect(shareBase()).toBe("http://localhost:3000/r");
    process.env.SHARE_BASE_URL = "https://exemple.test/";
    expect(shareUrl("x-y-z")).toBe("https://exemple.test/x-y-z");
  });
});
