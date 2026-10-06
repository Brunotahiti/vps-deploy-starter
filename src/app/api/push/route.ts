import { z } from "zod";
import { route, parseBody, ok } from "@/server/http";
import { requireEstablishment } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { isPushConfigured, listMyPushSubscriptions, pushConfig, subscribePush, unsubscribePush } from "@/server/push";

const subscriptionSchema = z.object({ endpoint: z.string().url().max(2000), keys: z.object({ p256dh: z.string().min(1).max(300), auth: z.string().min(1).max(100) }) });

/** Notifications push : clé publique du serveur et abonnements de la personne connectée. */
export const GET = route(async () => {
  const ctx = await requireEstablishment();
  const cfg = pushConfig();
  return ok({ enabled: cfg.enabled, publicKey: cfg.enabled ? cfg.publicKey : null, subscriptions: cfg.enabled ? await listMyPushSubscriptions(actorFrom(ctx)) : [] });
});

/** Enregistre l'abonnement de cet appareil (fourni par le navigateur). */
export const POST = route(async (req) => {
  const ctx = await requireEstablishment();
  const body = await parseBody(req, subscriptionSchema);
  return ok(await subscribePush(actorFrom(ctx), body, req.headers.get("user-agent")));
});

/** Retire l'abonnement de cet appareil. */
export const DELETE = route(async (req) => {
  const ctx = await requireEstablishment();
  const body = await parseBody(req, z.object({ endpoint: z.string().min(1).max(2000) }));
  if (!isPushConfigured()) return ok({ ok: true });
  return ok(await unsubscribePush(actorFrom(ctx), body.endpoint));
});
