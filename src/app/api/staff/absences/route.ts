import { route, ok, created, parseBody, parseQuery } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { absenceSchema, periodQuery } from "@/server/schemas";
import { listAbsences, upsertAbsence } from "@/server/services/planning";

/** Congés et absences du personnel */
export const GET = route(async (req) => {
  const ctx = await requirePermission("staff.manage");
  const q = parseQuery(req, periodQuery);
  return ok(await listAbsences(ctx.establishment.id, q.from, q.to));
});
export const POST = route(async (req) => {
  const ctx = await requirePermission("staff.manage");
  return created(await upsertAbsence(actorFrom(ctx), await parseBody(req, absenceSchema)));
});
