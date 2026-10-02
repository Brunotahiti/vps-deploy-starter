import { route, ok, created, parseBody } from "@/server/http";
import { requireHygiene } from "@/server/hygiene-auth";
import { actorFrom } from "@/server/auth/authorize";
import { cleaningTaskSchema } from "@/server/schemas";
import { listCleaningTasks, upsertCleaningTask } from "@/server/services/hygiene";

export const GET = route(async (req) => {
  const ctx = await requireHygiene("record");
  return ok(await listCleaningTasks(ctx.establishment.id, req.nextUrl.searchParams.get("all") === "1"));
});
export const POST = route(async (req) => {
  const ctx = await requireHygiene("manage");
  return created(await upsertCleaningTask(actorFrom(ctx), await parseBody(req, cleaningTaskSchema)));
});
