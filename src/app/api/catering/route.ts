import { route, ok, created, parseBody } from "@/server/http";
import { can } from "@/server/auth/context";
import { requireCatering } from "@/server/catering-auth";
import { actorFrom } from "@/server/auth/authorize";
import { eventCreateSchema } from "@/server/schemas";
import { createEvent, listEvents, listEventsLite } from "@/server/services/catering";

const day = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

/** Planning des événements ; sans le droit de gérer, sans les montants. */
export const GET = route(async (req) => {
  const ctx = await requireCatering("view");
  const q = req.nextUrl.searchParams;
  const opts = { from: day(q.get("from")), to: day(q.get("to")) };
  return ok(can(ctx, "catering.manage") ? await listEvents(ctx.establishment.id, ctx.establishment.timezone, opts) : await listEventsLite(ctx.establishment.id, ctx.establishment.timezone, opts));
});
export const POST = route(async (req) => {
  const ctx = await requireCatering("manage");
  return created(await createEvent(actorFrom(ctx), await parseBody(req, eventCreateSchema)));
});
