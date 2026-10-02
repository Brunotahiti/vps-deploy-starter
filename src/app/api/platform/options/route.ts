import { z } from "zod";
import { route, ok, parseBody } from "@/server/http";
import { requirePlatformAdmin } from "@/server/auth/platform";
import { optionPrices, pendingOptionRequests, setOptionPrice } from "@/server/services/options";

/** Console : prix des options et demandes en attente. */
export const GET = route(async () => {
  await requirePlatformAdmin();
  const [prices, requests] = await Promise.all([optionPrices(), pendingOptionRequests()]);
  return ok({ prices, requests });
});

/** Console : prix mensuel d'une option (vide = « sur demande »). */
export const PUT = route(async (req) => {
  const ctx = await requirePlatformAdmin();
  const { option, monthly } = await parseBody(req, z.object({ option: z.string().max(40), monthly: z.number().int().min(0).max(10_000_000).nullable() }));
  return ok(await setOptionPrice(option, monthly, { id: ctx.user.id, email: ctx.user.email }));
});
