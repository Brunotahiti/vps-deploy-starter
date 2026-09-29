import { route, parseBody, ok, created } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { productSchema } from "@/server/schemas";
import { createProduct, listProducts } from "@/server/services/catalog";

export const GET = route(async (req) => {
  const ctx = await requirePermission("catalog.view");
  const q = req.nextUrl.searchParams;
  return ok(await listProducts(ctx.establishment.id, { categoryId: q.get("categoryId") ?? undefined, search: q.get("search") ?? undefined, includeInactive: q.get("all") === "1" }));
});
export const POST = route(async (req) => {
  const ctx = await requirePermission("catalog.manage");
  return created(await createProduct(actorFrom(ctx), await parseBody(req, productSchema)));
});
