import { z } from "zod";
import { route, parseBody, ok } from "@/server/http";
import { requireAuth } from "@/server/auth/context";
import { switchSessionEstablishment } from "@/server/auth/session";
import { ApiError } from "@/server/errors";

export const POST = route(async (req) => {
  const ctx = await requireAuth();
  const { establishmentId } = await parseBody(req, z.object({ establishmentId: z.string().uuid() }));
  if (!ctx.establishments.some((e) => e.id === establishmentId)) throw new ApiError(403, "FORBIDDEN", "Établissement non autorisé");
  await switchSessionEstablishment(ctx.sessionId, establishmentId);
  return ok({ establishmentId });
});
