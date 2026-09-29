import { route, ok } from "@/server/http";
import { digitalSettings, publicCatalog, resolveEstablishment } from "@/server/services/public";

export const dynamic = "force-dynamic";
/** Boutique en ligne : établissement, réglages de commande en ligne, catalogue. */
export const GET = route<{ org: string; est: string }>(async (_req, { params }) => {
  const est = await resolveEstablishment(params.org, params.est);
  const settings = await digitalSettings(est.id);
  return ok({ establishment: est, online: settings.online, catalog: await publicCatalog(est.id) });
});
