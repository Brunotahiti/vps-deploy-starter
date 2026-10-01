import { route, ok } from "@/server/http";
import { headers } from "next/headers";
import { getTerminalFromCookie, createSession, requestMeta, setSessionCookie } from "@/server/auth/session";
import { ApiError } from "@/server/errors";
import { findOfflinePass } from "@/server/services/offline-pass";
import { OFFLINE_PASS_HEADER } from "@/server/auth/context";
import { rateLimit } from "@/server/rate-limit";

/** Retour du réseau : l'employé connecté hors ligne (laissez-passer) reçoit une vraie session sur ce terminal. */
export const POST = route(async () => {
  const terminal = await getTerminalFromCookie();
  if (!terminal) throw new ApiError(400, "NO_TERMINAL", "Cet appareil n'est pas enregistré comme terminal");
  await rateLimit(`offline-session:${terminal.id}`, 30, 3_600_000);
  const token = (await headers()).get(OFFLINE_PASS_HEADER);
  const pass = token ? await findOfflinePass(token, terminal.id) : null;
  if (!pass) throw new ApiError(401, "INVALID_PASS", "Reconnectez-vous avec votre PIN");
  const meta = await requestMeta();
  const { token: sessionToken } = await createSession({ userId: pass.userId, establishmentId: pass.establishmentId, terminalId: terminal.id, ...meta });
  await setSessionCookie(sessionToken);
  return ok({ id: pass.userId });
});
