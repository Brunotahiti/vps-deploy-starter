import { route, ok } from "@/server/http";
import { ApiError } from "@/server/errors";
import { screenDisplay } from "@/server/services/screens";

/** Données affichées par un écran en salle (adresse secrète, sans connexion). */
export const GET = route<{ token: string }>(async (_req, { params }) => {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(params.token)) throw new ApiError(404, "NOT_FOUND", "Écran introuvable");
  return ok(await screenDisplay(params.token), { headers: { "Cache-Control": "no-store" } });
});
