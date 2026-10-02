import { z } from "zod";
import { route, created, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { rateLimit } from "@/server/rate-limit";
import { requestOption } from "@/server/services/options";

/** « Débloquer » : demande envoyée à l'équipe ManaResto, qui active l'option. */
export const POST = route(async (req) => {
  const ctx = await requirePermission("settings.manage");
  await rateLimit(`option-request:${ctx.organizationId}`, 10, 3_600_000);
  const { option } = await parseBody(req, z.object({ option: z.string().max(40) }));
  const r = await requestOption(actorFrom(ctx), option);
  return created({ option: r.option, requestedAt: r.createdAt });
});
