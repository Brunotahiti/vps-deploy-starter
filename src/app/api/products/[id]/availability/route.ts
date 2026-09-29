import { z } from "zod";
import { route, parseBody, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { setProductAvailability } from "@/server/services/catalog";

export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("catalog.availability");
  const { isAvailable } = await parseBody(req, z.object({ isAvailable: z.boolean() }));
  return ok(await setProductAvailability(actorFrom(ctx), params.id, isAvailable));
});
