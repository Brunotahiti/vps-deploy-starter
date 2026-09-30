import { route, ok, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { assignServerSchema } from "@/server/schemas";
import { assignServer } from "@/server/services/service-tracking";

/** Attribue la table (sa commande en cours) à un serveur. */
export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("pos.use");
  const body = await parseBody(req, assignServerSchema);
  await assignServer(actorFrom(ctx), params.id, body.serverId ?? null);
  return ok({ assigned: true });
});
