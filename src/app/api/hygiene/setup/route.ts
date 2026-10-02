import { route, ok } from "@/server/http";
import { requireHygiene } from "@/server/hygiene-auth";
import { actorFrom } from "@/server/auth/authorize";
import { setupStarterPlan } from "@/server/services/hygiene";

/** Plan de départ (équipements et nettoyages courants), seulement là où rien n'existe encore. */
export const POST = route(async () => {
  const ctx = await requireHygiene("manage");
  return ok(await setupStarterPlan(actorFrom(ctx)));
});
