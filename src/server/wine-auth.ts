import { can, requireEstablishment, requireOption } from "@/server/auth/context";
import { ApiError } from "@/server/errors";

/** Cave à vin : option « wine » débloquée, puis « use » (fiches, accords, bouteilles ouvertes) ou « manage » (fiches, prix, cave, rapport). */
export async function requireWine(level: "use" | "manage") {
  const ctx = await requireEstablishment();
  requireOption(ctx, "wine");
  const allowed = level === "manage" ? can(ctx, "wine.manage") : can(ctx, "wine.use") || can(ctx, "wine.manage");
  if (!allowed) throw new ApiError(403, "FORBIDDEN", `Permission requise : wine.${level}`, { permission: `wine.${level}` });
  return ctx;
}
