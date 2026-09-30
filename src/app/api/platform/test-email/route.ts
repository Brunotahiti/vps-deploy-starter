import { route, ok } from "@/server/http";
import { requirePlatformAdmin } from "@/server/auth/platform";
import { sendTestEmail } from "@/server/services/platform-emails";

/** Envoie un e-mail de test aux destinataires des alertes et renvoie l'erreur SMTP expliquée en cas d'échec. */
export const POST = route(async () => {
  await requirePlatformAdmin();
  return ok(await sendTestEmail());
});
