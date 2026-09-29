import { route, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { getPosCatalog } from "@/server/services/catalog";

export const GET = route(async () => {
  const ctx = await requirePermission("pos.use");
  return ok(await getPosCatalog(ctx.establishment.id));
});
