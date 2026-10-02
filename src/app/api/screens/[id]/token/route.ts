import { route, ok } from "@/server/http";
import { requireScreens } from "@/server/screens-auth";
import { actorFrom } from "@/server/auth/authorize";
import { regenerateScreenToken } from "@/server/services/screens";

/** Nouvelle adresse secrète pour l'écran : l'ancienne ne fonctionne plus. */
export const POST = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requireScreens();
  return ok(await regenerateScreenToken(actorFrom(ctx), params.id));
});
