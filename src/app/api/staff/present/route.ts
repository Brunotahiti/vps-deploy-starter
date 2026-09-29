import { route, ok } from "@/server/http";
import { requireEstablishment } from "@/server/auth/context";
import { presentNow } from "@/server/services/staff";

export const GET = route(async () => {
  const ctx = await requireEstablishment();
  return ok(await presentNow(ctx.establishment.id));
});
