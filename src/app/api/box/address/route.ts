import { z } from "zod";
import { route, ok, parseBody } from "@/server/http";
import { requireBox } from "@/server/box/boxes";
import { setBoxAddress } from "@/server/box/certificate";

export const dynamic = "force-dynamic";

/** Boîtier → cloud : son adresse sur le réseau du restaurant (enregistrement DNS de son adresse HTTPS). */
export const POST = route(async (req) => {
  const box = await requireBox(req);
  const { lanIp } = await parseBody(req, z.object({ lanIp: z.string().max(15) }));
  return ok({ hostname: await setBoxAddress(box, lanIp) });
});
