import { route, parseBody, ok } from "@/server/http";
import { pinLoginSchema } from "@/server/schemas";
import { loginWithPin } from "@/server/services/auth";
import { getTerminalFromCookie } from "@/server/auth/session";
import { ApiError } from "@/server/errors";

export const POST = route(async (req) => {
  const body = await parseBody(req, pinLoginSchema);
  const terminal = await getTerminalFromCookie();
  if (!terminal) throw new ApiError(400, "NO_TERMINAL", "Cet appareil n'est pas enregistré comme terminal");
  const user = await loginWithPin(terminal.establishmentId, body.pin, terminal.id);
  return ok({ id: user.id, firstName: user.firstName, lastName: user.lastName, displayName: user.displayName });
});
