import { route, ok, created, parseBody, parseQuery } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { periodQuery, timeEntrySchema } from "@/server/schemas";
import { listEntries, upsertEntry } from "@/server/services/staff";
import { endOfLocalDay, startOfLocalDay } from "@/lib/dates";

export const GET = route(async (req) => {
  const ctx = await requirePermission("staff.manage");
  const q = parseQuery(req, periodQuery.extend({ employeeId: periodQuery.shape.from.optional() }));
  const tz = ctx.establishment.timezone;
  return ok(await listEntries(ctx.establishment.id, startOfLocalDay(q.from, tz), endOfLocalDay(q.to, tz), req.nextUrl.searchParams.get("employeeId") ?? undefined));
});
export const POST = route(async (req) => {
  const ctx = await requirePermission("staff.manage");
  return created(await upsertEntry(actorFrom(ctx), await parseBody(req, timeEntrySchema)));
});
