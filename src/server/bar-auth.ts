import { can, requireEstablishment, requireOption } from "@/server/auth/context";
import { ApiError } from "@/server/errors";

/** Bar : option « bar » débloquée, puis « use » (ardoises, fiches, casse) ou « manage » (happy hour, cave, rapport). */
export async function requireBar(level: "use" | "manage") {
  const ctx = await requireEstablishment();
  requireOption(ctx, "bar");
  const allowed = level === "manage" ? can(ctx, "bar.manage") : can(ctx, "bar.use") || can(ctx, "bar.manage");
  if (!allowed) throw new ApiError(403, "FORBIDDEN", `Permission requise : bar.${level}`, { permission: `bar.${level}` });
  return ctx;
}
