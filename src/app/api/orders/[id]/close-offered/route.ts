import { route, ok } from "@/server/http";
import { requirePermission, requireOption } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { closeOffered } from "@/server/services/bar";

/** Addition entièrement offerte (option Bar) : clôture sans encaissement. */
export const POST = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requirePermission("pos.use");
  requireOption(ctx, "bar");
  return ok(await closeOffered(actorFrom(ctx), params.id));
});
