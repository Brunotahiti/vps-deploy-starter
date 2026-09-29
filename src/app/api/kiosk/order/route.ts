import { route, ok, parseBody } from "@/server/http";
import { ApiError } from "@/server/errors";
import { getTerminalFromCookie } from "@/server/auth/session";
import { kioskOrderSchema } from "@/server/schemas";
import { createKioskOrder } from "@/server/services/public";

export const POST = route(async (req) => {
  const terminal = await getTerminalFromCookie();
  if (!terminal) throw new ApiError(401, "NO_TERMINAL", "Cet appareil n'est pas enregistré comme borne");
  return ok(await createKioskOrder(terminal.establishmentId, terminal.id, await parseBody(req, kioskOrderSchema)));
});
