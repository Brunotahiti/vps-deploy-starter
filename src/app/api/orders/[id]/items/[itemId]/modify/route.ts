import { z } from "zod";
import { route, ok, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { modifyItem } from "@/server/services/kitchen-changes";

const schema = z.object({ modifiers: z.array(z.object({ modifierId: z.string().uuid(), quantity: z.number().int().min(1).max(20).optional() })).max(50), note: z.string().max(300).nullable().optional() });

/** Modifie un plat (options, note) ; déjà envoyé, la cuisine reçoit « MODIFICATION — TABLE … » */
export const POST = route<{ id: string; itemId: string }>(async (req, { params }) => {
  const ctx = await requirePermission("pos.use");
  return ok(await modifyItem(actorFrom(ctx), params.id, params.itemId, await parseBody(req, schema)));
});
