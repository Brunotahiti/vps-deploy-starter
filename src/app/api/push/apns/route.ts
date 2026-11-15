import { z } from "zod";
import { route, parseBody, ok } from "@/server/http";
import { requireEstablishment } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { isApnsConfigured, registerApnsDevice, unregisterApnsDevice } from "@/server/apns";

const tokenSchema = z.string().trim().min(64).max(200);

/** App iOS : les notifications « plat prêt » sont-elles disponibles sur ce serveur ? */
export const GET = route(async () => {
  await requireEstablishment();
  return ok({ enabled: isApnsConfigured() });
});

/** Enregistre l'iPhone / iPad (jeton APNs) au nom de la personne connectée. */
export const POST = route(async (req) => {
  const ctx = await requireEstablishment();
  const body = await parseBody(req, z.object({ token: tokenSchema, environment: z.enum(["production", "sandbox"]).default("production"), deviceName: z.string().max(80).nullable().optional() }));
  return ok(await registerApnsDevice(actorFrom(ctx), body));
});

/** Retire l'appareil (changement d'utilisateur, déconnexion, notifications désactivées). */
export const DELETE = route(async (req) => {
  const ctx = await requireEstablishment();
  const body = await parseBody(req, z.object({ token: tokenSchema }));
  return ok(await unregisterApnsDevice(actorFrom(ctx), body.token));
});
