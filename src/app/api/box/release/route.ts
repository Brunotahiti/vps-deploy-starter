import fs from "node:fs";
import { Readable } from "node:stream";
import { route } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
import { requireBox } from "@/server/box/boxes";
import { releaseArchive, releaseId } from "@/server/box/release";

export const dynamic = "force-dynamic";

/** Cloud → boîtier : la version de l'application à installer sur le mini-PC (archive .tar.gz, clé du boîtier). */
export const GET = route(async (req) => {
  const box = await requireBox(req);
  await rateLimit(`box-release:${box.id}`, 6, 3_600_000);
  const file = await releaseArchive();
  return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, {
    headers: { "content-type": "application/gzip", "content-length": String(fs.statSync(file).size), "x-box-release": releaseId(), "cache-control": "no-store" },
  });
});
