import { route, ok, created, parseBody } from "@/server/http";
import { requireHygiene } from "@/server/hygiene-auth";
import { actorFrom } from "@/server/auth/authorize";
import { hygieneEquipmentSchema } from "@/server/schemas";
import { listEquipment, upsertEquipment } from "@/server/services/hygiene";

export const GET = route(async (req) => {
  const ctx = await requireHygiene("record");
  return ok(await listEquipment(ctx.establishment.id, req.nextUrl.searchParams.get("all") === "1"));
});
export const POST = route(async (req) => {
  const ctx = await requireHygiene("manage");
  return created(await upsertEquipment(actorFrom(ctx), await parseBody(req, hygieneEquipmentSchema)));
});
