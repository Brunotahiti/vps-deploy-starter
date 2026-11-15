import { route, ok, created, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { shiftTemplateSchema } from "@/server/schemas";
import { listShiftTemplates, upsertShiftTemplate } from "@/server/services/planning";

/** Semaine type du planning */
export const GET = route(async () => {
  const ctx = await requirePermission("staff.manage");
  return ok(await listShiftTemplates(ctx.establishment.id));
});
export const POST = route(async (req) => {
  const ctx = await requirePermission("staff.manage");
  return created(await upsertShiftTemplate(actorFrom(ctx), await parseBody(req, shiftTemplateSchema)));
});
