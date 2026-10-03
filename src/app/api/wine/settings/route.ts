import { route, ok, parseBody } from "@/server/http";
import { requireWine } from "@/server/wine-auth";
import { actorFrom } from "@/server/auth/authorize";
import { wineSettingsSchema } from "@/server/schemas";
import { updateWineSettings, wineSettings } from "@/server/services/wine";

/** Réglages de la carte des vins : titre, présentation, affichage sur le site. */
export const GET = route(async () => {
  const ctx = await requireWine("use");
  return ok(await wineSettings(ctx.establishment.id));
});
export const PUT = route(async (req) => {
  const ctx = await requireWine("manage");
  return ok(await updateWineSettings(actorFrom(ctx), await parseBody(req, wineSettingsSchema)));
});
