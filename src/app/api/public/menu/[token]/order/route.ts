import { route, ok, parseBody } from "@/server/http";
import { rateLimitIp } from "@/server/rate-limit";
import { tableOrderSchema } from "@/server/schemas";
import { orderFromTable } from "@/server/services/public";

export const POST = route<{ token: string }>(async (req, { params }) => {
  await rateLimitIp(req, "public-order", 20);
  return ok(await orderFromTable(params.token, await parseBody(req, tableOrderSchema)));
});
