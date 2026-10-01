import { z } from "zod";
import { route, ok, parseBody } from "@/server/http";
import { requirePlatformAdmin } from "@/server/auth/platform";
import { rateLimit } from "@/server/rate-limit";
import { sendWelcomePreview } from "@/server/services/platform-emails";

const schema = z.object({ to: z.string().trim().email().max(160) });

/** Console : envoie un aperçu du vrai e-mail de bienvenue à l'adresse indiquée. */
export const POST = route(async (req) => {
  const ctx = await requirePlatformAdmin();
  await rateLimit(`preview-email:${ctx.user.id}`, 10, 60 * 60_000);
  const { to } = await parseBody(req, schema);
  return ok(await sendWelcomePreview(to, ctx.user.firstName));
});
