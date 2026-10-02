import { z } from "zod";
import { route, ok, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { setChangeStatus } from "@/server/services/kitchen-changes";

/** Cuisine : modification « vue » puis « appliquée » */
export const POST = route<{ changeId: string }>(async (req, { params }) => {
  const ctx = await requirePermission("kds.use");
  const { status } = await parseBody(req, z.object({ status: z.enum(["SEEN", "APPLIED"]) }));
  return ok(await setChangeStatus(actorFrom(ctx), params.changeId, status));
});
