import { route, ok } from "@/server/http";
import { prisma } from "@/server/db";
import { requireBox } from "@/server/box/boxes";
import { exportSnapshot } from "@/server/box/snapshot";

export const dynamic = "force-dynamic";

/** Cloud → boîtier : copie de l'établissement du boîtier (clé `mrbox_…`). */
export const GET = route(async (req) => {
  const box = await requireBox(req);
  return ok(await exportSnapshot(prisma, box.establishmentId));
});
