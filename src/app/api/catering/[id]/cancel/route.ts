import { route, ok, parseBody } from "@/server/http";
import { requireCatering } from "@/server/catering-auth";
import { actorFrom } from "@/server/auth/authorize";
import { eventCancelSchema } from "@/server/schemas";
import { cancelEvent } from "@/server/services/catering";

export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requireCatering("manage");
  return ok(await cancelEvent(actorFrom(ctx), params.id, (await parseBody(req, eventCancelSchema)).reason));
});
