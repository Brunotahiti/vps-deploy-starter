import { z } from "zod";
import { route, ok, parseBody } from "@/server/http";
import { requirePlatformAdmin } from "@/server/auth/platform";
import { setOrganizationOptions } from "@/server/services/options";

/** Console : options actives d'un restaurant. */
export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePlatformAdmin();
  const { options } = await parseBody(req, z.object({ options: z.array(z.string().max(40)).max(10) }));
  return ok(await setOrganizationOptions(params.id, options, { id: ctx.user.id, email: ctx.user.email }));
});
