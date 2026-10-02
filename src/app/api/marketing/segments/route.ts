import { route, ok, parseQuery } from "@/server/http";
import { z } from "zod";
import { requireMarketing } from "@/server/marketing-auth";
import { campaignSegment } from "@/server/schemas";
import { previewSegment } from "@/server/services/marketing";

/** Combien de clients recevront la campagne (seulement ceux qui l'ont accepté). */
export const GET = route(async (req) => {
  const ctx = await requireMarketing("manage");
  const { segment } = parseQuery(req, z.object({ segment: campaignSegment }));
  return ok(await previewSegment(ctx.establishment.id, segment));
});
