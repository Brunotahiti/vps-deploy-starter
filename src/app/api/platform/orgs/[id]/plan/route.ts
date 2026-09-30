import { z } from "zod";
import { route, parseBody, ok } from "@/server/http";
import { requirePlatformAdmin } from "@/server/auth/platform";
import { setOrganizationPlan } from "@/server/services/platform";

const schema = z.object({ plan: z.enum(["TRIAL", "ACTIVE", "SUSPENDED"]), trialEndsAt: z.string().max(40).nullable().optional(), periodEndsAt: z.string().max(40).nullable().optional() });

export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePlatformAdmin();
  return ok(await setOrganizationPlan(params.id, await parseBody(req, schema), { id: ctx.user.id, email: ctx.user.email }));
});
