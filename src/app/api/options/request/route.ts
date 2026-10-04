import { z } from "zod";
import { route, created, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { rateLimit } from "@/server/rate-limit";
import { requestOptions } from "@/server/services/options";

/** « Débloquer » (une option) ou « Envoyer ma demande » (sélection) : demande envoyée à l'équipe ManaResto, qui active. */
export const POST = route(async (req) => {
  const ctx = await requirePermission("settings.manage");
  await rateLimit(`option-request:${ctx.organizationId}`, 10, 3_600_000);
  const body = await parseBody(req, z.object({ option: z.string().max(40).optional(), options: z.array(z.string().max(40)).max(20).optional() }).refine((b) => b.option || b.options?.length, "Choisissez au moins une option"));
  const rows = await requestOptions(actorFrom(ctx), body.options ?? [body.option!]);
  // Réponse d'une seule option : forme historique ; sélection : la liste
  if (!body.options) return created({ option: rows[0].option, requestedAt: rows[0].createdAt });
  return created({ requested: rows.map((r) => ({ option: r.option, requestedAt: r.createdAt })) });
});
