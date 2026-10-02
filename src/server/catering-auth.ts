import { can, requireEstablishment, requireOption } from "@/server/auth/context";
import { ApiError } from "@/server/errors";

/** Traiteur : option « catering » débloquée, puis « view » (planning, fiche cuisine) ou « manage » (devis, paiements, factures). */
export async function requireCatering(level: "view" | "manage") {
  const ctx = await requireEstablishment();
  requireOption(ctx, "catering");
  const allowed = level === "manage" ? can(ctx, "catering.manage") : can(ctx, "catering.view") || can(ctx, "catering.manage");
  if (!allowed) throw new ApiError(403, "FORBIDDEN", `Permission requise : catering.${level}`, { permission: `catering.${level}` });
  return ctx;
}
