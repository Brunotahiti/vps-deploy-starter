import { route, parseBody, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom, authorizeSensitive } from "@/server/auth/authorize";
import { removeItemSchema, updateItemSchema } from "@/server/schemas";
import { getOrder, removeItem, updateItem } from "@/server/services/orders";

export const PATCH = route<{ id: string; itemId: string }>(async (req, { params }) => {
  const ctx = await requirePermission("pos.use");
  return ok(await updateItem(actorFrom(ctx), params.id, params.itemId, await parseBody(req, updateItemSchema)));
});

export const DELETE = route<{ id: string; itemId: string }>(async (req, { params }) => {
  const ctx = await requirePermission("pos.use");
  const body = await parseBody(req, removeItemSchema).catch(() => ({ reason: null, managerPin: undefined }));
  const order = await getOrder(ctx.establishment.id, params.id);
  const item = order.items.find((i) => i.id === params.itemId);
  // Article déjà envoyé en cuisine → permission pos.void_item ou PIN manager
  const actor = item && item.status !== "PENDING" ? await authorizeSensitive(ctx, "pos.void_item", body.managerPin) : actorFrom(ctx);
  return ok(await removeItem(actor, params.id, params.itemId, body.reason));
});
