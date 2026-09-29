import { route, ok, created, parseBody, parseQuery } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { periodQuery, shiftSchema } from "@/server/schemas";
import { listShifts, upsertShift } from "@/server/services/staff";
import { endOfLocalDay, startOfLocalDay } from "@/lib/dates";

export const GET = route(async (req) => {
  const ctx = await requirePermission("staff.manage");
  const q = parseQuery(req, periodQuery);
  const tz = ctx.establishment.timezone;
  return ok(await listShifts(ctx.establishment.id, startOfLocalDay(q.from, tz), endOfLocalDay(q.to, tz)));
});
export const POST = route(async (req) => {
  const ctx = await requirePermission("staff.manage");
  return created(await upsertShift(actorFrom(ctx), await parseBody(req, shiftSchema)));
});
