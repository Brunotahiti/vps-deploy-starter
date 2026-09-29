import { z } from "zod";
import { route, parseBody, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { emailReceipt } from "@/server/services/receipt-email";
import { isEmailConfigured } from "@/server/email/mailer";

/** GET : l'envoi est-il configuré ? · POST { email } : envoie le reçu PDF au client. */
export const GET = route(async () => {
  await requirePermission("pos.use");
  return ok({ configured: isEmailConfigured() });
});

export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("pos.use");
  const { email } = await parseBody(req, z.object({ email: z.string().trim().email().max(120) }));
  return ok(await emailReceipt(actorFrom(ctx), params.id, email.toLowerCase()));
});
