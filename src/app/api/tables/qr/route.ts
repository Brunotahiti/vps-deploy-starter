import { route, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { tableQrList } from "@/server/services/public";

export const GET = route(async (req) => {
  const ctx = await requirePermission("floor.manage");
  const base = process.env.PUBLIC_URL?.replace(/\/$/, "") || req.nextUrl.origin;
  return ok(await tableQrList(ctx.establishment.id, base));
});
