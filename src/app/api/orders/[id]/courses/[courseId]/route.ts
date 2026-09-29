import { route, parseBody, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { courseStatusSchema } from "@/server/schemas";
import { setCourseStatus } from "@/server/services/orders";

export const POST = route<{ id: string; courseId: string }>(async (req, { params }) => {
  const ctx = await requirePermission("pos.use");
  const { status } = await parseBody(req, courseStatusSchema);
  return ok(await setCourseStatus(actorFrom(ctx), params.id, params.courseId, status));
});
