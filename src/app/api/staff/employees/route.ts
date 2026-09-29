import { route, ok, created, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { employeeSchema } from "@/server/schemas";
import { listEmployees, upsertEmployee } from "@/server/services/staff";

export const GET = route(async (req) => {
  const ctx = await requirePermission("staff.manage");
  return ok(await listEmployees(ctx.establishment.id, req.nextUrl.searchParams.get("all") === "1"));
});
export const POST = route(async (req) => {
  const ctx = await requirePermission("staff.manage");
  return created(await upsertEmployee(actorFrom(ctx), await parseBody(req, employeeSchema)));
});
