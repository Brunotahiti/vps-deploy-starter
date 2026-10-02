import { route, ok, parseBody } from "@/server/http";
import { requireEstablishment, requireOption } from "@/server/auth/context";
import { clockSchema } from "@/server/schemas";
import { clock } from "@/server/services/staff";

/** Pointage ARRIVÉE / PAUSE / REPRISE / DÉPART depuis un appareil connecté ; l'employé est identifié par son PIN. */
export const POST = route(async (req) => {
  const ctx = await requireEstablishment();
  requireOption(ctx, "team");
  const body = await parseBody(req, clockSchema);
  return ok(await clock(ctx.establishment.id, body.pin, body.kind, ctx.terminal?.id ?? null));
});
