import { z } from "zod";
import { route, ok, parseBody } from "@/server/http";
import { requirePlatformAdmin } from "@/server/auth/platform";
import { handleServiceRequest } from "@/server/services/options";

/** Console : demande de service ponctuel traitée ou refusée. */
export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePlatformAdmin();
  const { status } = await parseBody(req, z.object({ status: z.enum(["DONE", "DECLINED"]) }));
  return ok(await handleServiceRequest(params.id, status, { id: ctx.user.id, email: ctx.user.email }));
});
