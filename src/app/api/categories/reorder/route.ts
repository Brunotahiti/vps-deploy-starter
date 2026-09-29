import { z } from "zod";
import { route, parseBody, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { reorderCategories } from "@/server/services/catalog";

export const POST = route(async (req) => {
  const ctx = await requirePermission("catalog.manage");
  const { ids } = await parseBody(req, z.object({ ids: z.array(z.string().uuid()) }));
  await reorderCategories(actorFrom(ctx), ids);
  return ok({ reordered: true });
});
