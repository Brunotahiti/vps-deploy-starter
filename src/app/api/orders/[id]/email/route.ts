import { z } from "zod";
import { route, parseBody, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { emailReceipt } from "@/server/services/receipt-email";
import { isEmailConfigured } from "@/server/email/mailer";
import { rateLimit } from "@/server/rate-limit";

/** GET : l'envoi est-il configuré ? · POST { email } : envoie le reçu PDF au client. */
export const GET = route(async () => {
  await requirePermission("pos.use");
  return ok({ configured: isEmailConfigured() });
});

export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("pos.use");
  // Pas un relais d'envoi de courriels : 20 reçus par quart d'heure et par personne, 200 par heure et par établissement
  await rateLimit(`receipt-email:${ctx.user.id}`, 20, 15 * 60_000);
  await rateLimit(`receipt-email-est:${ctx.establishment.id}`, 200, 60 * 60_000);
  const { email } = await parseBody(req, z.object({ email: z.string().trim().email().max(120) }));
  return ok(await emailReceipt(actorFrom(ctx), params.id, email.toLowerCase()));
});
