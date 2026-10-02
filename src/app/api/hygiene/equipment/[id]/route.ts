import { route, ok, parseBody } from "@/server/http";
import { requireHygiene } from "@/server/hygiene-auth";
import { actorFrom } from "@/server/auth/authorize";
import { hygieneEquipmentSchema } from "@/server/schemas";
import { archiveEquipment, upsertEquipment } from "@/server/services/hygiene";

export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requireHygiene("manage");
  return ok(await upsertEquipment(actorFrom(ctx), { id: params.id, ...(await parseBody(req, hygieneEquipmentSchema)) }));
});
export const DELETE = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requireHygiene("manage");
  await archiveEquipment(actorFrom(ctx), params.id);
  return ok({ archived: true });
});
