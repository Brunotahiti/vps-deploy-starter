import { route, ok, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { printerSchema } from "@/server/schemas";
import { deletePrinter, upsertPrinter } from "@/server/hardware/printers";

export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("settings.manage");
  return ok(await upsertPrinter(actorFrom(ctx), { id: params.id, ...(await parseBody(req, printerSchema)) }));
});
export const DELETE = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requirePermission("settings.manage");
  await deletePrinter(actorFrom(ctx), params.id);
  return ok({ deleted: true });
});
