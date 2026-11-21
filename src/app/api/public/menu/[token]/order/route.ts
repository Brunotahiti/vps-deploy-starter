import { route, ok, parseBody } from "@/server/http";
import { rateLimit, rateLimitIp } from "@/server/rate-limit";
import { tableOrderSchema } from "@/server/schemas";
import { orderFromTable } from "@/server/services/public";

export const POST = route<{ token: string }>(async (req, { params }) => {
  await rateLimitIp(req, "public-order", 20);
  // Par table aussi : un QR gardé après le repas (ou des adresses qui changent) ne doit pas inonder la cuisine
  await rateLimit(`public-table-order:${params.token.slice(0, 64)}`, 20, 60 * 60_000);
  return ok(await orderFromTable(params.token, await parseBody(req, tableOrderSchema)));
});
