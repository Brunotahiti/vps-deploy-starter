import { z } from "zod";
import { route, ok, parseBody } from "@/server/http";
import { openBoxSession, requireBox } from "@/server/box/boxes";

export const dynamic = "force-dynamic";

/** Boîtier → cloud : session du cloud pour une connexion faite sur le boîtier pendant une coupure (clé `mrbox_…`). */
export const POST = route(async (req) => {
  const box = await requireBox(req);
  const { userId } = await parseBody(req, z.object({ userId: z.string().uuid() }));
  return ok(await openBoxSession(req, box, userId));
});
