import { route, ok, parseBody } from "@/server/http";
import { requirePermission, requireOption } from "@/server/auth/context";
import { authorizeSensitive } from "@/server/auth/authorize";
import { offerItemSchema, unofferItemSchema } from "@/server/schemas";
import { offerItem, unofferItem } from "@/server/services/bar";

/** Article offert (option Bar) : motif obligatoire, droit de remise ou PIN d'un responsable. */
export const POST = route<{ id: string; itemId: string }>(async (req, { params }) => {
  const ctx = await requirePermission("pos.use");
  requireOption(ctx, "bar");
  const body = await parseBody(req, offerItemSchema);
  const actor = await authorizeSensitive(ctx, "pos.discount", body.managerPin);
  return ok(await offerItem(actor, params.id, params.itemId, body.reason));
});
/** Annule l'offre : même droit que pour offrir. */
export const DELETE = route<{ id: string; itemId: string }>(async (req, { params }) => {
  const ctx = await requirePermission("pos.use");
  requireOption(ctx, "bar");
  const body = await parseBody(req, unofferItemSchema).catch(() => ({ managerPin: undefined }));
  const actor = await authorizeSensitive(ctx, "pos.discount", body.managerPin);
  return ok(await unofferItem(actor, params.id, params.itemId));
});
