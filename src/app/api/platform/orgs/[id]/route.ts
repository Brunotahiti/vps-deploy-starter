import { route, ok } from "@/server/http";
import { requirePlatformAdmin } from "@/server/auth/platform";
import { platformOrgDetail } from "@/server/services/platform";

export const GET = route<{ id: string }>(async (_req, { params }) => {
  await requirePlatformAdmin();
  return ok(await platformOrgDetail(params.id));
});
