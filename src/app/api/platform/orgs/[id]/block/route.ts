import { z } from "zod";
import { route, parseBody, ok } from "@/server/http";
import { requirePlatformAdmin } from "@/server/auth/platform";
import { ApiError } from "@/server/errors";
import { setOrganizationBlocked } from "@/server/services/platform";

const schema = z.object({ blocked: z.boolean(), reason: z.string().max(300).nullable().optional() });

export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePlatformAdmin();
  const body = await parseBody(req, schema);
  if (body.blocked && params.id === ctx.organizationId) throw new ApiError(400, "SELF_BLOCK", "Vous ne pouvez pas bloquer votre propre compte");
  return ok(await setOrganizationBlocked(params.id, body.blocked, body.reason, { id: ctx.user.id, email: ctx.user.email }));
});
