import { route, ok, parseBody } from "@/server/http";
import { requireScreens } from "@/server/screens-auth";
import { actorFrom } from "@/server/auth/authorize";
import { screenSchema } from "@/server/schemas";
import { deleteScreen, upsertScreen } from "@/server/services/screens";

export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requireScreens();
  return ok(await upsertScreen(actorFrom(ctx), { id: params.id, ...(await parseBody(req, screenSchema)) }));
});
export const DELETE = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requireScreens();
  await deleteScreen(actorFrom(ctx), params.id);
  return ok({ deleted: true });
});
