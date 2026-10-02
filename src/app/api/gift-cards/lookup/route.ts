import { route, ok } from "@/server/http";
import { requireMarketing } from "@/server/marketing-auth";
import { ApiError } from "@/server/errors";
import { lookupGiftCard } from "@/server/services/marketing";

/** Solde et validité d'une carte cadeau, d'après son code (caisse). */
export const GET = route(async (req) => {
  const ctx = await requireMarketing("use");
  const code = req.nextUrl.searchParams.get("code")?.trim();
  if (!code || code.length > 20) throw new ApiError(400, "BAD_CODE", "Code de carte cadeau invalide");
  return ok(await lookupGiftCard(ctx.establishment.id, code));
});
