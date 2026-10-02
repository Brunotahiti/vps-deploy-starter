import { z } from "zod";
import { route, created, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { rateLimit } from "@/server/rate-limit";
import { requestService } from "@/server/services/options";

/** Demande d'un service ponctuel, transmise à l'équipe ManaResto. */
export const POST = route(async (req) => {
  const ctx = await requirePermission("settings.manage");
  await rateLimit(`service-request:${ctx.organizationId}`, 10, 3_600_000);
  const { service, note } = await parseBody(req, z.object({ service: z.string().max(40), note: z.string().trim().max(500).nullable().optional() }));
  const r = await requestService(actorFrom(ctx), service, note);
  return created({ service, requestedAt: r.createdAt });
});
