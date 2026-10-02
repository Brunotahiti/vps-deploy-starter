import { can, requireEstablishment, requireOption } from "@/server/auth/context";
import { ApiError } from "@/server/errors";

/**
 * Marketing : option « marketing » débloquée, puis « sell » (vendre une carte cadeau), « use » (utiliser une carte
 * à la caisse) ou « manage » (campagnes, avis, gestion des cartes).
 */
export async function requireMarketing(level: "use" | "sell" | "manage") {
  const ctx = await requireEstablishment();
  requireOption(ctx, "marketing");
  const allowed = level === "manage" ? can(ctx, "marketing.manage")
    : level === "sell" ? can(ctx, "giftcards.sell") || can(ctx, "marketing.manage")
    : can(ctx, "pos.use") || can(ctx, "giftcards.sell") || can(ctx, "marketing.manage");
  if (!allowed) throw new ApiError(403, "FORBIDDEN", `Permission requise : ${level === "manage" ? "marketing.manage" : level === "sell" ? "giftcards.sell" : "pos.use"}`);
  return ctx;
}
