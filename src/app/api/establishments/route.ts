import { route, parseBody, ok, created } from "@/server/http";
import { requireAuth, requirePermission } from "@/server/auth/context";
import { establishmentCreateSchema } from "@/server/schemas";
import { createEstablishment, listEstablishments } from "@/server/services/establishments";

export const GET = route(async () => {
  const ctx = await requireAuth();
  const all = await listEstablishments(ctx.organizationId);
  const allowed = new Set(ctx.establishments.map((e) => e.id));
  return ok(all.filter((e) => allowed.has(e.id)));
});

export const POST = route(async (req) => {
  const ctx = await requirePermission("establishments.manage");
  const body = await parseBody(req, establishmentCreateSchema);
  return created(await createEstablishment(ctx.organizationId, ctx.user.id, body));
});
