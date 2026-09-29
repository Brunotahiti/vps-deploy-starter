import { route, parseBody, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { roomSchema } from "@/server/schemas";
import { deleteRoom, upsertRoom } from "@/server/services/floor";

export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("floor.manage");
  return ok(await upsertRoom(actorFrom(ctx), { id: params.id, ...(await parseBody(req, roomSchema)) }));
});
export const DELETE = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requirePermission("floor.manage");
  await deleteRoom(actorFrom(ctx), params.id);
  return ok({ deleted: true });
});
