import { z } from "zod";
import { route, parseBody, parseQuery, ok, created } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { orderCreateSchema, daySchema } from "@/server/schemas";
import { createOrder, listOpenOrders, listOrders } from "@/server/services/orders";
import { withIdempotency } from "@/server/idempotency";
import { endOfLocalDay, startOfLocalDay } from "@/lib/dates";

export const GET = route(async (req) => {
  const ctx = await requirePermission("pos.use");
  const q = parseQuery(req, z.object({ open: z.string().optional(), status: z.string().optional(), day: daySchema.optional(), tableId: z.string().uuid().optional(), take: z.coerce.number().int().min(1).max(200).optional(), skip: z.coerce.number().int().min(0).optional() }));
  if (q.open === "1") return ok(await listOpenOrders(ctx.establishment.id));
  const tz = ctx.establishment.timezone;
  return ok(await listOrders(ctx.establishment.id, { status: q.status, tableId: q.tableId, from: q.day ? startOfLocalDay(q.day, tz) : undefined, to: q.day ? endOfLocalDay(q.day, tz) : undefined, take: q.take, skip: q.skip }));
});

export const POST = route(async (req) => {
  const ctx = await requirePermission("pos.use");
  const body = await parseBody(req, orderCreateSchema);
  return withIdempotency(req, ctx.establishment.id, async () => created(await createOrder(actorFrom(ctx), body)));
});
