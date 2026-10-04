import { route, ok, parseBody } from "@/server/http";
import { requireBar } from "@/server/bar-auth";
import { actorFrom } from "@/server/auth/authorize";
import { bottleSchema } from "@/server/schemas";
import { upsertBottle } from "@/server/services/bar";

export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requireBar("manage");
  return ok(await upsertBottle(actorFrom(ctx), { ...(await parseBody(req, bottleSchema)), id: params.id }));
});
