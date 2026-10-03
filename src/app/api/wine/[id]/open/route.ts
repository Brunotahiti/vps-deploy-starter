import { route, created } from "@/server/http";
import { requireWine } from "@/server/wine-auth";
import { actorFrom } from "@/server/auth/authorize";
import { openBottle } from "@/server/services/wine";

/** Ouvre une bouteille pour le service au verre. */
export const POST = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requireWine("use");
  return created(await openBottle(actorFrom(ctx), params.id));
});
