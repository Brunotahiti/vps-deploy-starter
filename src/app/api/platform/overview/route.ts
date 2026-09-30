import { route, ok } from "@/server/http";
import { requirePlatformAdmin } from "@/server/auth/platform";
import { platformOverview } from "@/server/services/platform";

export const GET = route(async () => {
  await requirePlatformAdmin();
  return ok(await platformOverview());
});
