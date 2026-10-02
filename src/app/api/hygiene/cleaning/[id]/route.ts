import { route, ok, parseBody } from "@/server/http";
import { requireHygiene } from "@/server/hygiene-auth";
import { actorFrom } from "@/server/auth/authorize";
import { cleaningTaskSchema } from "@/server/schemas";
import { archiveCleaningTask, upsertCleaningTask } from "@/server/services/hygiene";

export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requireHygiene("manage");
  return ok(await upsertCleaningTask(actorFrom(ctx), { id: params.id, ...(await parseBody(req, cleaningTaskSchema)) }));
});
export const DELETE = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requireHygiene("manage");
  await archiveCleaningTask(actorFrom(ctx), params.id);
  return ok({ archived: true });
});
