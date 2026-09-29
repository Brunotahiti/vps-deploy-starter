import { route, ok } from "@/server/http";
import { requireApiKey } from "@/server/api-keys";

/** API publique v1 — identité de la clé et portées. */
export const GET = route(async (req) => {
  const ctx = await requireApiKey(req, "catalog:read").catch(async () => requireApiKey(req, "orders:read"));
  return ok({ establishment: ctx.establishment, scopes: ctx.scopes, version: "1" });
});
