import { route, ok, parseBody } from "@/server/http";
import { requireEstablishment, requireOption } from "@/server/auth/context";
import { clockIdentifySchema } from "@/server/schemas";
import { clockStatus } from "@/server/services/staff";

/** Identifie l'employé par PIN et renvoie son état (hors service / en service / en pause) et les actions possibles. */
export const POST = route(async (req) => {
  const ctx = await requireEstablishment();
  requireOption(ctx, "team");
  const body = await parseBody(req, clockIdentifySchema);
  return ok(await clockStatus(ctx.establishment.id, body.pin));
});
