import { prisma } from "@/server/db";
import { ApiError } from "@/server/errors";
import type { Actor } from "@/server/services/orders";

/**
 * Notifications push (Web Push, norme VAPID) : « Plat prêt ! » sur le téléphone ou la tablette du serveur, même
 * l'écran éteint ou l'application en arrière-plan. Les clés VAPID sont dans l'environnement (VAPID_PUBLIC_KEY,
 * VAPID_PRIVATE_KEY, VAPID_SUBJECT) ; sans elles la fonction est simplement indisponible (bouton masqué).
 * Les abonnements sont au nom de la personne connectée : un serveur reçoit les plats de SES tables ; une
 * commande sans serveur abonné (comptoir, à emporter) prévient toute l'équipe abonnée. La cuisine n'est jamais
 * notifiée de son propre geste.
 */
export type PushPayload = { title: string; body: string; url: string; tag: string; renotify?: boolean };
type Subscription = { endpoint: string; keys: { p256dh: string; auth: string } };
type SendResult = { ok: true } | { ok: false; gone: boolean; error: string };
type Transport = (sub: Subscription, payload: string) => Promise<SendResult>;

export const PUSH_TRANSPORT_MEMORY = "memory";
/** Transport mémoire (tests) : notifications gardées ici au lieu d'être envoyées. */
export const sentPushes: { endpoint: string; payload: PushPayload }[] = [];

export function pushConfig() {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:contact@manaresto.com";
  if (process.env.PUSH_TRANSPORT === PUSH_TRANSPORT_MEMORY) return { enabled: true, publicKey: publicKey || "test-public-key", privateKey: privateKey || "test", subject };
  return { enabled: !!publicKey && !!privateKey, publicKey: publicKey ?? "", privateKey: privateKey ?? "", subject };
}
export const isPushConfigured = () => pushConfig().enabled;

const webPushTransport: Transport = async (sub, payload) => {
  const cfg = pushConfig();
  const webpush = (await import("web-push")).default;
  try {
    await webpush.sendNotification(sub, payload, { vapidDetails: { subject: cfg.subject, publicKey: cfg.publicKey, privateKey: cfg.privateKey }, TTL: 600, urgency: "high" });
    return { ok: true };
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode ?? 0;
    return { ok: false, gone: status === 404 || status === 410, error: `HTTP ${status || "?"} ${(e as Error).message ?? ""}`.slice(0, 200) };
  }
};
/** PUSH_TRANSPORT=memory (tests) : rien n'est envoyé, les notifications sont gardées dans sentPushes. */
const memoryTransport: Transport = async (sub, payload) => { sentPushes.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) as PushPayload }); return { ok: true }; };
const defaultTransport: Transport = (sub, payload) => (process.env.PUSH_TRANSPORT === PUSH_TRANSPORT_MEMORY ? memoryTransport : webPushTransport)(sub, payload);
let transport: Transport = defaultTransport;
export function setPushTransport(t: Transport | null) { transport = t ?? defaultTransport; }

/** Abonnement d'un appareil au nom de la personne connectée (un endpoint n'appartient qu'à une personne à la fois). */
export async function subscribePush(actor: Actor, sub: Subscription, userAgent?: string | null) {
  if (!isPushConfigured()) throw new ApiError(503, "PUSH_DISABLED", "Notifications push non configurées sur ce serveur");
  if (!/^https:\/\//.test(sub.endpoint)) throw new ApiError(400, "BAD_ENDPOINT", "Abonnement invalide");
  const row = await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: { establishmentId: actor.establishmentId, userId: actor.userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: userAgent?.slice(0, 200) ?? null },
    update: { establishmentId: actor.establishmentId, userId: actor.userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: userAgent?.slice(0, 200) ?? null, failures: 0 },
  });
  return { id: row.id };
}

export async function unsubscribePush(actor: Actor, endpoint: string) {
  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: actor.userId } });
  return { ok: true };
}

export async function listMyPushSubscriptions(actor: Actor) {
  return prisma.pushSubscription.findMany({ where: { userId: actor.userId, establishmentId: actor.establishmentId }, select: { id: true, endpoint: true, userAgent: true, createdAt: true, lastUsedAt: true } });
}

/**
 * Envoie une notification aux abonnements choisis : ceux du serveur de la commande s'il en a, sinon toute l'équipe
 * abonnée de l'établissement. La personne à l'origine du geste (la cuisine) est exclue.
 */
export async function sendPush(establishmentId: string, target: { userId: string | null; excludeUserId?: string | null }, payload: PushPayload) {
  if (!isPushConfigured()) return { sent: 0 };
  const all = await prisma.pushSubscription.findMany({ where: { establishmentId, ...(target.excludeUserId ? { userId: { not: target.excludeUserId } } : {}) } });
  const mine = target.userId ? all.filter((s) => s.userId === target.userId) : [];
  const recipients = mine.length ? mine : all;
  if (recipients.length === 0) return { sent: 0 };
  const body = JSON.stringify(payload);
  let sent = 0;
  await Promise.all(recipients.map(async (s) => {
    const r = await transport({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body).catch((e): SendResult => ({ ok: false, gone: false, error: String((e as Error).message ?? e).slice(0, 200) }));
    if (r.ok) { sent++; await prisma.pushSubscription.update({ where: { id: s.id }, data: { lastUsedAt: new Date(), failures: 0 } }).catch(() => {}); return; }
    // Abonnement expiré (appareil réinitialisé, notifications coupées) : retiré ; autre erreur : comptée, retiré après 10 échecs d'affilée
    if (r.gone || s.failures + 1 >= 10) await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
    else await prisma.pushSubscription.update({ where: { id: s.id }, data: { failures: { increment: 1 } } }).catch(() => {});
    console.warn("[push] envoi refusé", r.error);
  }));
  return { sent };
}

/** Plat(s) prêt(s) en cuisine : le serveur de la commande est prévenu (ou l'équipe si la commande n'a pas de serveur abonné). */
export async function notifyDishReady(actor: Actor, ticket: { orderId: string; items: { name: string; quantity: number; status: string }[]; course?: { name: string } | null; order: { number: string; type: string; serverId: string | null; customerName: string | null; tableLabel?: string | null; table: { name: string } | null } }) {
  if (!isPushConfigured()) return { sent: 0 };
  const live = ticket.items.filter((i) => i.status !== "VOIDED");
  if (live.length === 0) return { sent: 0 };
  // Mode roulotte : la notification ouvre le portail Salle, où les plats prêts s'affichent avec leur table
  const est = await prisma.establishment.findUnique({ where: { id: actor.establishmentId }, select: { settings: true } });
  const roulotte = ((est?.settings ?? {}) as { payAtOrder?: boolean }).payAtOrder === true;
  const where = ticket.order.table ? `Table ${ticket.order.table.name}` : ticket.order.tableLabel ? `Table ${ticket.order.tableLabel}${ticket.order.customerName ? ` · ${ticket.order.customerName}` : ""}` : `${typeLabel(ticket.order.type)} n° ${ticket.order.number.split("-").pop()}${ticket.order.customerName ? ` · ${ticket.order.customerName}` : ""}`;
  const dishes = live.map((i) => `${i.quantity > 1 ? `${i.quantity} × ` : ""}${i.name}`).join(", ");
  const total = live.reduce((a, i) => a + i.quantity, 0);
  // Sans table (comptoir, roulotte, à emporter) : le serveur va chercher le plat en cuisine et le remet au client ;
  // la notification ouvre la file des commandes (« À emporter »), où « Remise au client » clôt le parcours
  const todo = ticket.order.table || ticket.order.tableLabel ? "à apporter" : ticket.order.type === "TAKEAWAY" || ticket.order.type === "ONLINE" ? "à remettre au client (n° appelé)" : ticket.order.type === "DELIVERY" ? "à remettre au livreur" : "à apporter au client";
  return sendPush(actor.establishmentId, { userId: ticket.order.serverId, excludeUserId: actor.userId }, {
    title: `${total > 1 ? "Plats prêts" : "Plat prêt"} · ${where}`,
    body: `${dishes}${ticket.course?.name && ticket.course.name !== "COMMANDE" ? ` (${ticket.course.name.toLowerCase()})` : ""} — ${todo}`.slice(0, 180),
    url: ticket.order.table ? `/pos/order/${ticket.orderId}` : roulotte ? "/pos/salle" : "/pos/emporter",
    tag: `ready-${ticket.orderId}`,
    renotify: true,
  });
}

function typeLabel(type: string) {
  return ({ DINE_IN: "Sur place", COUNTER: "Sur place", TAKEAWAY: "À emporter", DELIVERY: "Livraison", ONLINE: "En ligne", KIOSK: "Borne" } as Record<string, string>)[type] ?? type;
}
