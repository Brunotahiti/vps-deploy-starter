import { route, ok } from "@/server/http";
import { digitalSettings, publicCatalog, resolveEstablishment } from "@/server/services/public";
import { DEMO_PUBLIC_MESSAGE, demoPublicClosed } from "@/lib/platform";

export const dynamic = "force-dynamic";
/** Boutique en ligne : établissement, réglages de commande en ligne, catalogue. */
export const GET = route<{ org: string; est: string }>(async (_req, { params }) => {
  const est = await resolveEstablishment(params.org, params.est);
  const settings = await digitalSettings(est.id);
  // Restaurant exemple : la carte reste visible, la commande et la réservation sont fermées
  const demo = demoPublicClosed(params.org);
  const online = demo ? { ...settings.online, enabled: false, message: DEMO_PUBLIC_MESSAGE } : settings.online;
  return ok({ establishment: est, online, demo, catalog: await publicCatalog(est.id) });
});
