import { route, created, parseBody } from "@/server/http";
import { requireHygiene } from "@/server/hygiene-auth";
import { actorFrom } from "@/server/auth/authorize";
import { cleaningDoneSchema } from "@/server/schemas";
import { markCleaningDone } from "@/server/services/hygiene";

/** Nettoyage fait (qui, quand, remarque éventuelle). */
export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requireHygiene("record");
  const body = await parseBody(req, cleaningDoneSchema);
  return created(await markCleaningDone(actorFrom(ctx), params.id, body.note));
});
