import { route, ok, created, parseBody } from "@/server/http";
import { requireMarketing } from "@/server/marketing-auth";
import { actorFrom } from "@/server/auth/authorize";
import { campaignSchema } from "@/server/schemas";
import { listCampaigns, sendCampaign } from "@/server/services/marketing";

export const GET = route(async () => {
  const ctx = await requireMarketing("manage");
  return ok(await listCampaigns(ctx.establishment.id));
});
/** Envoi d'une campagne aux clients inscrits du segment (en arrière-plan ; le suivi se met à jour). */
export const POST = route(async (req) => {
  const ctx = await requireMarketing("manage");
  return created(await sendCampaign(actorFrom(ctx), await parseBody(req, campaignSchema)));
});
