import { z } from "zod";
import { route, ok, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { daySchema } from "@/server/schemas";
import { saveWeekAsTemplate } from "@/server/services/planning";

/** « Garder cette semaine comme semaine type » */
export const POST = route(async (req) => {
  const ctx = await requirePermission("staff.manage");
  const { monday } = await parseBody(req, z.object({ monday: daySchema }));
  return ok(await saveWeekAsTemplate(actorFrom(ctx), monday));
});
