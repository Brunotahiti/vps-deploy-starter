import { z } from "zod";
import { route, parseBody, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { importRowSchema } from "@/server/schemas";
import { importProducts } from "@/server/services/catalog";

export const POST = route(async (req) => {
  const ctx = await requirePermission("catalog.manage");
  const { rows } = await parseBody(req, z.object({ rows: z.array(importRowSchema).min(1).max(5000) }));
  return ok(await importProducts(actorFrom(ctx), rows));
});
