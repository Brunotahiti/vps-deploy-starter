import { route, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { cloudUrl, regenerateCloudToken } from "@/server/hardware/printers";

/** Nouvelle adresse d'interrogation pour une imprimante connectée (affichée une seule fois). */
export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("settings.manage");
  const token = await regenerateCloudToken(actorFrom(ctx), params.id);
  return ok({ cloudUrl: cloudUrl(process.env.PUBLIC_URL || req.nextUrl.origin, token) });
});
