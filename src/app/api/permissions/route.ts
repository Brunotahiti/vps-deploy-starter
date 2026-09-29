import { route, ok } from "@/server/http";
import { requireAuth } from "@/server/auth/context";
import { PERMISSIONS } from "@/lib/permissions";

export const GET = route(async () => {
  await requireAuth();
  return ok(Object.entries(PERMISSIONS).map(([key, v]) => ({ key, ...v })));
});
