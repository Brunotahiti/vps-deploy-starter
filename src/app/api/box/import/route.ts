import { route, ok } from "@/server/http";
import { prisma } from "@/server/db";
import { ApiError } from "@/server/errors";
import { requireBoxSecret } from "@/server/box/boxes";
import { importSnapshot, type BoxSnapshot } from "@/server/box/snapshot";

export const dynamic = "force-dynamic";

/** Boîtier uniquement : la passerelle locale remplace la base par la dernière copie du cloud. */
export const POST = route(async (req) => {
  requireBoxSecret(req);
  const snap = (await req.json().catch(() => null)) as BoxSnapshot | null;
  if (!snap?.tables) throw new ApiError(400, "BAD_SNAPSHOT", "Copie invalide");
  try {
    return ok({ imported: await importSnapshot(prisma, snap) });
  } catch (e) {
    throw new ApiError(409, "SNAPSHOT_REFUSED", e instanceof Error ? e.message : "Copie refusée");
  }
});
