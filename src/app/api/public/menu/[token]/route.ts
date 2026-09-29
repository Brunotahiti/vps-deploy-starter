import { route, ok } from "@/server/http";
import { tableMenu } from "@/server/services/public";

export const dynamic = "force-dynamic";
/** Menu à table (QR code) : public, sans session. */
export const GET = route<{ token: string }>(async (_req, { params }) => ok(await tableMenu(params.token)));
