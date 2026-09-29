import { route, ok, created, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { printerSchema } from "@/server/schemas";
import { listPrinters, upsertPrinter } from "@/server/hardware/printers";

export const GET = route(async () => {
  const ctx = await requirePermission("pos.use");
  return ok(await listPrinters(ctx.establishment.id));
});
export const POST = route(async (req) => {
  const ctx = await requirePermission("settings.manage");
  return created(await upsertPrinter(actorFrom(ctx), await parseBody(req, printerSchema)));
});
