import { route, ok } from "@/server/http";
import { getTerminalFromCookie } from "@/server/auth/session";
import { pinTeam } from "@/server/services/users";
import { ApiError } from "@/server/errors";

/** Équipe affichée sur l'écran PIN du terminal : on touche son nom, puis on tape son PIN. */
export const GET = route(async () => {
  const terminal = await getTerminalFromCookie();
  if (!terminal) throw new ApiError(400, "NO_TERMINAL", "Cet appareil n'est pas enregistré comme terminal");
  return ok(await pinTeam(terminal.establishmentId));
});
