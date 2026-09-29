import { route, ok } from "@/server/http";
import { trackOrder } from "@/server/services/public";

export const dynamic = "force-dynamic";
export const GET = route<{ token: string }>(async (_req, { params }) => ok(await trackOrder(params.token)));
