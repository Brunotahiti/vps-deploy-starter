import { route, ok } from "@/server/http";
import { requireOption, requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { lookupCaller } from "@/server/services/reservations";

/** Client qui appelle, retrouvé par son numéro de téléphone (réservations avancées, option Digital) */
export const GET = route(async (req) => {
  const ctx = await requirePermission("pos.use");
  requireOption(ctx, "digital");
  return ok(await lookupCaller(actorFrom(ctx), req.nextUrl.searchParams.get("phone") ?? ""));
});
