import { route, ok } from "@/server/http";
import { ApiError } from "@/server/errors";
import { getTerminalFromCookie } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { digitalSettings, publicCatalog } from "@/server/services/public";

export const dynamic = "force-dynamic";
/** Borne : identifiée par le cookie terminal (appareil enregistré de type KIOSK), sans session utilisateur. */
export const GET = route(async () => {
  const terminal = await getTerminalFromCookie();
  if (!terminal) throw new ApiError(401, "NO_TERMINAL", "Cet appareil n'est pas enregistré comme borne");
  const est = await prisma.establishment.findUniqueOrThrow({ where: { id: terminal.establishmentId }, select: { id: true, name: true, currency: true, timezone: true } });
  const settings = await digitalSettings(est.id);
  return ok({ establishment: est, terminal: { id: terminal.id, name: terminal.name, kind: terminal.kind }, kiosk: settings.kiosk, catalog: await publicCatalog(est.id) });
});
