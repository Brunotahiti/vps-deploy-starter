import { route, ok, parseBody } from "@/server/http";
import { requireEstablishment, can } from "@/server/auth/context";
import { ApiError } from "@/server/errors";
import { printSchema } from "@/server/schemas";
import { printDocument } from "@/server/hardware/printers";

/** Impression d'un reçu, d'un bon cuisine ou d'un test sur une imprimante configurée. */
export const POST = route(async (req) => {
  const ctx = await requireEstablishment();
  if (!can(ctx, "pos.use") && !can(ctx, "kds.use") && !can(ctx, "settings.manage")) throw new ApiError(403, "FORBIDDEN", "Permission requise");
  const body = await parseBody(req, printSchema);
  // Test du tiroir depuis les réglages uniquement (l'ouverture en service passe par /api/hardware/drawer, tracée)
  if (body.kind === "drawer" && !can(ctx, "settings.manage")) throw new ApiError(403, "FORBIDDEN", "Permission requise");
  const doc = body.kind === "receipt" ? { kind: "receipt" as const, orderId: body.orderId! } : body.kind === "kitchen" ? { kind: "kitchen" as const, ticketId: body.ticketId! } : body.kind === "drawer" ? { kind: "drawer" as const } : { kind: "test" as const };
  if ((doc.kind === "receipt" && !body.orderId) || (doc.kind === "kitchen" && !body.ticketId)) throw new ApiError(400, "MISSING", "Identifiant manquant");
  return ok(await printDocument(ctx.establishment.id, body.printerId, doc));
});
