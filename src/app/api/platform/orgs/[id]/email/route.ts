import { z } from "zod";
import { route, parseBody, ok } from "@/server/http";
import { requirePlatformAdmin } from "@/server/auth/platform";
import { sendManualEmail } from "@/server/services/platform-emails";

const schema = z.object({ subject: z.string().trim().min(2).max(150), message: z.string().trim().min(2).max(5000) });

export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePlatformAdmin();
  const body = await parseBody(req, schema);
  return ok(await sendManualEmail(params.id, body.subject, body.message, ctx.user.id));
});
