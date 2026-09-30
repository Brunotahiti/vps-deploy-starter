import { route, ok, parseBody } from "@/server/http";
import { prisma } from "@/server/db";
import { rateLimitIp, clientIp } from "@/server/rate-limit";
import { demoRequestSchema } from "@/server/schemas";
import { demoRequestMail, isEmailConfigured, sendMail } from "@/server/email/mailer";
import { consoleUrl, teamRecipients } from "@/server/services/platform-emails";

/** Demande de démonstration depuis le site vitrine : enregistrée en base, e-mail à l'équipe ManaResto (PLATFORM_NOTIFY_EMAILS, sinon contact@manaresto.com) si le SMTP est configuré. */
export const POST = route(async (req) => {
  rateLimitIp(req, "demo-request", 5, 10 * 60_000);
  const body = await parseBody(req, demoRequestSchema);
  // Anti-spam : pot de miel rempli ou formulaire envoyé en moins de 3 secondes → on répond « ok » sans rien enregistrer
  if (body.website || (body.startedAt && Date.now() - body.startedAt < 3000)) return ok({ received: true });
  const row = await prisma.demoRequest.create({ data: { restaurantName: body.restaurantName, contactName: body.contactName, phone: body.phone, email: body.email.toLowerCase(), commune: body.commune, kind: body.kind, message: body.message || null, consent: true, ip: clientIp(req), userAgent: req.headers.get("user-agent")?.slice(0, 300) ?? null } });
  let emailSent = false;
  if (isEmailConfigured()) {
    try { await sendMail(demoRequestMail({ to: teamRecipients(), ...body, message: body.message || null, consoleUrl: consoleUrl() })); emailSent = true; } catch (e) { console.error("[demo-request] e-mail non envoyé", e); }
  }
  if (emailSent) await prisma.demoRequest.update({ where: { id: row.id }, data: { emailSent: true } });
  return ok({ received: true });
});
