import { route, ok, parseBody } from "@/server/http";
import { requireCatering } from "@/server/catering-auth";
import { actorFrom } from "@/server/auth/authorize";
import { eventUpdateSchema } from "@/server/schemas";
import { deleteEvent, getEvent, updateEvent } from "@/server/services/catering";

export const GET = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requireCatering("manage");
  return ok(await getEvent(ctx.establishment.id, params.id));
});
export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requireCatering("manage");
  return ok(await updateEvent(actorFrom(ctx), params.id, await parseBody(req, eventUpdateSchema)));
});
export const DELETE = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requireCatering("manage");
  return ok(await deleteEvent(actorFrom(ctx), params.id));
});
