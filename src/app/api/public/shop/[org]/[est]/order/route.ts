import { route, ok, parseBody } from "@/server/http";
import { onlineOrderSchema } from "@/server/schemas";
import { createOnlineOrder } from "@/server/services/public";

export const POST = route<{ org: string; est: string }>(async (req, { params }) => {
  const body = await parseBody(req, onlineOrderSchema);
  return ok(await createOnlineOrder(params.org, params.est, { ...body, email: body.email || null }));
});
