import { route, ok } from "@/server/http";
import { restaurantSite } from "@/server/services/public";

export const dynamic = "force-dynamic";
/** Site public du restaurant : coordonnées, horaires, réglages du site, canaux ouverts et menu allégé. */
export const GET = route<{ org: string; est: string }>(async (_req, { params }) => ok(await restaurantSite(params.org, params.est)));
