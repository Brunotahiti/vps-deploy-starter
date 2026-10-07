import { route, parseBody, ok } from "@/server/http";
import { pinLoginByUserSchema } from "@/server/schemas";
import { loginWithPin } from "@/server/services/auth";
import { getTerminalFromCookie } from "@/server/auth/session";
import { ApiError } from "@/server/errors";

/** Connexion par PIN sur un terminal enregistré ; `userId` (nom touché sur l'écran) évite toute ambiguïté de PIN. */
export const POST = route(async (req) => {
  const body = await parseBody(req, pinLoginByUserSchema);
  const terminal = await getTerminalFromCookie();
  if (!terminal) throw new ApiError(400, "NO_TERMINAL", "Cet appareil n'est pas enregistré comme terminal");
  const user = await loginWithPin(terminal.establishmentId, body.pin, terminal.id, body.userId);
  return ok({ id: user.id, firstName: user.firstName, lastName: user.lastName, displayName: user.displayName });
});
