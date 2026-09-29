import { route, parseBody, ok, created } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { userCreateSchema } from "@/server/schemas";
import { createUser, listUsers } from "@/server/services/users";

export const GET = route(async (req) => {
  const ctx = await requirePermission("users.manage");
  const all = req.nextUrl.searchParams.get("all") === "1" && ctx.user.isOwner;
  return ok(await listUsers(ctx.organizationId, all ? undefined : ctx.establishment.id));
});

export const POST = route(async (req) => {
  const ctx = await requirePermission("users.manage");
  const body = await parseBody(req, userCreateSchema);
  const u = await createUser(ctx.organizationId, ctx.user.id, body);
  return created({ id: u.id, email: u.email });
});
