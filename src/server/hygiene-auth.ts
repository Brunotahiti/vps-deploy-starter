import { can, requireEstablishment, requireOption } from "@/server/auth/context";
import { ApiError } from "@/server/errors";

/**
 * Accès à l'hygiène : option « hygiene » débloquée, puis « record » (relevés, nettoyages, traçabilité : toute
 * l'équipe concernée) ou « manage » (équipements, plan de nettoyage, registre). Gérer permet aussi d'enregistrer.
 */
export async function requireHygiene(level: "record" | "manage") {
  const ctx = await requireEstablishment();
  requireOption(ctx, "hygiene");
  const allowed = level === "manage" ? can(ctx, "hygiene.manage") : can(ctx, "hygiene.record") || can(ctx, "hygiene.manage");
  if (!allowed) throw new ApiError(403, "FORBIDDEN", `Permission requise : hygiene.${level}`, { permission: `hygiene.${level}` });
  return ctx;
}
