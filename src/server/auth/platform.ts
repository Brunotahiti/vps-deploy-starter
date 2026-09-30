import { ApiError } from "@/server/errors";
import { parseAdminEmails } from "@/lib/platform";
import { requireAuth } from "./context";

/** L'adresse fait-elle partie des administrateurs de la plateforme (PLATFORM_ADMIN_EMAILS) ? */
export function isPlatformAdminEmail(email: string | null | undefined) {
  if (!email) return false;
  return parseAdminEmails(process.env.PLATFORM_ADMIN_EMAILS).includes(email.toLowerCase());
}

/** Accès à la console plateforme : administrateur ManaResto connecté, hors session de prise en main. */
export async function requirePlatformAdmin() {
  const ctx = await requireAuth();
  if (ctx.impersonatorId || !isPlatformAdminEmail(ctx.user.email)) throw new ApiError(403, "FORBIDDEN", "Réservé à l'équipe ManaResto");
  return ctx;
}
