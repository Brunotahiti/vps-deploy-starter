import { z } from "zod";
import { route, parseBody, ok } from "@/server/http";
import { requirePlatformAdmin } from "@/server/auth/platform";
import { setDemoRequestStatus } from "@/server/services/platform";

const schema = z.object({ status: z.enum(["NEW", "CONTACTED", "DONE"]) });

export const PATCH = route<{ id: string }>(async (req, { params }) => {
  await requirePlatformAdmin();
  return ok(await setDemoRequestStatus(params.id, (await parseBody(req, schema)).status));
});
