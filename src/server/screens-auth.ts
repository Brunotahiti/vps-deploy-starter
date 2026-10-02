import { requireOption, requirePermission } from "@/server/auth/context";

/** Écrans en salle : option « screens » et droit de gérer les paramètres de l'établissement. */
export async function requireScreens() {
  const ctx = await requirePermission("settings.manage");
  requireOption(ctx, "screens");
  return ctx;
}
