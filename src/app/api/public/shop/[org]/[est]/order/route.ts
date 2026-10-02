import { route, ok, parseBody } from "@/server/http";
import { rateLimit, rateLimitIp } from "@/server/rate-limit";
import { onlineOrderSchema } from "@/server/schemas";
import { createOnlineOrder, resolveEstablishment } from "@/server/services/public";

export const POST = route<{ org: string; est: string }>(async (req, { params }) => {
  await rateLimitIp(req, "public-order", 20);
  await rateLimitIp(req, "public-order-hour", 40, 60 * 60_000);
  const body = await parseBody(req, onlineOrderSchema);
  // Afflux anormal de commandes sur un même restaurant (toutes adresses confondues)
  const est = await resolveEstablishment(params.org, params.est);
  await rateLimit(`public-order-est:${est.id}`, 300, 60 * 60_000);
  return ok(await createOnlineOrder(params.org, params.est, { ...body, email: body.email || null }));
});
