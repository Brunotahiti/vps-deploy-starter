import { route, ok } from "@/server/http";
import { requireHygiene } from "@/server/hygiene-auth";
import { hygieneToday } from "@/server/services/hygiene";

/** Ce qu'il reste à faire aujourd'hui : relevés, nettoyages, dates limites proches. */
export const GET = route(async () => {
  const ctx = await requireHygiene("record");
  return ok(await hygieneToday(ctx.establishment.id));
});
