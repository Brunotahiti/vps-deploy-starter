import { route, parseBody, ok, created } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { roomSchema } from "@/server/schemas";
import { listRooms, upsertRoom } from "@/server/services/floor";

export const GET = route(async () => {
  const ctx = await requirePermission("pos.use");
  return ok(await listRooms(ctx.establishment.id));
});
export const POST = route(async (req) => {
  const ctx = await requirePermission("floor.manage");
  return created(await upsertRoom(actorFrom(ctx), await parseBody(req, roomSchema)));
});
