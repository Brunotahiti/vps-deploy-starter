import { route, ok } from "@/server/http";
import { requireApiKey } from "@/server/api-keys";
import { getOrder } from "@/server/services/orders";
import { publicOrder } from "../route";

export const GET = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requireApiKey(req, "orders:read");
  return ok(publicOrder(await getOrder(ctx.establishmentId, params.id)));
});
