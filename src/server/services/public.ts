import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db";
import { ApiError } from "@/server/errors";
import { publish } from "@/server/realtime/bus";
import { getPosCatalog } from "./catalog";
import { createOrder, addItem, sendCourse, cancelOrder, getOrder, type Actor } from "./orders";
import { findOrCreatePublicCustomer } from "./customers";
import type { ProductChoice } from "@/components/pos/product-modal";

/**
 * Phase 6 — Canaux clients : menu et commande par QR code à table, commande en ligne
 * (click & collect / livraison), borne, suivi de commande.
 * Réglages dans establishment.settings.digital :
 *   qrMode : MENU | MENU_CALL | ORDER | ORDER_DIRECT
 *   online : { enabled, pickup, delivery, pickupLeadMin, deliveryFee, deliveryMinOrder, deliveryZones: string[], message }
 *   kiosk  : { enabled, dineIn, takeaway }
 * Site du restaurant (Phase 10) dans establishment.settings.site : { enabled, tagline, description, coverUrl, logoUrl, photos, facebook, instagram, showMenu, showPrices, accent }
 */
export type QrMode = "MENU" | "MENU_CALL" | "ORDER" | "ORDER_DIRECT";
export type DigitalSettings = {
  qrMode: QrMode;
  online: { enabled: boolean; pickup: boolean; delivery: boolean; pickupLeadMin: number; deliveryFee: number; deliveryMinOrder: number; deliveryZones: string[]; message: string };
  kiosk: { enabled: boolean; dineIn: boolean; takeaway: boolean };
};
export const DEFAULT_DIGITAL: DigitalSettings = {
  qrMode: "MENU_CALL",
  online: { enabled: false, pickup: true, delivery: false, pickupLeadMin: 20, deliveryFee: 500, deliveryMinOrder: 3000, deliveryZones: [], message: "" },
  kiosk: { enabled: false, dineIn: true, takeaway: true },
};

export type SiteSettings = { enabled: boolean; tagline: string; description: string; coverUrl: string; logoUrl: string; photos: string[]; facebook: string; instagram: string; showMenu: boolean; showPrices: boolean; accent: string };
export const DEFAULT_SITE: SiteSettings = { enabled: true, tagline: "", description: "", coverUrl: "", logoUrl: "", photos: [], facebook: "", instagram: "", showMenu: true, showPrices: true, accent: "#14aaa3" };

/** Réglages du site public du restaurant (fusionnés avec les valeurs par défaut). */
export async function siteSettings(establishmentId: string): Promise<SiteSettings> {
  const est = await prisma.establishment.findUniqueOrThrow({ where: { id: establishmentId }, select: { settings: true } });
  const s = ((est.settings ?? {}) as { site?: Partial<SiteSettings> }).site ?? {};
  return { ...DEFAULT_SITE, ...s, photos: Array.isArray(s.photos) ? s.photos : [] };
}

export async function digitalSettings(establishmentId: string): Promise<DigitalSettings> {
  const est = await prisma.establishment.findUniqueOrThrow({ where: { id: establishmentId }, select: { settings: true } });
  const s = ((est.settings ?? {}) as { digital?: Partial<DigitalSettings> }).digital ?? {};
  return { qrMode: s.qrMode ?? DEFAULT_DIGITAL.qrMode, online: { ...DEFAULT_DIGITAL.online, ...(s.online ?? {}) }, kiosk: { ...DEFAULT_DIGITAL.kiosk, ...(s.kiosk ?? {}) } };
}

const estPublic = { id: true, organizationId: true, name: true, slug: true, city: true, island: true, phone: true, email: true, addressLine1: true, currency: true, timezone: true, locale: true, openingHours: true, organization: { select: { slug: true } } } as const;

/** Menu allégé pour le site du restaurant : catégories, produits (nom, description, prix, photo, variantes) et formules, sans options ni stocks. */
export async function siteMenu(establishmentId: string) {
  const c = await publicCatalog(establishmentId);
  return {
    categories: c.categories.map(({ id, name, parentId, imageUrl }) => ({ id, name, parentId, imageUrl })),
    products: c.products.map((p) => ({ id: p.id, name: p.name, description: p.description, categoryId: p.categoryId, priceTtc: p.priceTtc, imageUrl: p.imageUrl, variants: p.variants.map((v) => ({ name: v.name, priceTtc: v.priceTtc })) })),
    menus: c.menus.map((m) => ({ id: m.id, name: m.name, description: m.description, priceTtc: m.priceTtc, imageUrl: m.imageUrl, sections: m.sections.map((sec) => ({ name: sec.name, items: sec.items.map((i) => i.product.name) })) })),
  };
}

/** Site public du restaurant : coordonnées, horaires, réglages du site, canaux ouverts (commande en ligne, réservation) et menu. */
export async function restaurantSite(orgSlug: string, estSlug: string) {
  const est = await prisma.establishment.findFirst({ where: { slug: estSlug, isActive: true, organization: { slug: orgSlug } }, select: { ...estPublic, addressLine2: true, postalCode: true } });
  if (!est) throw new ApiError(404, "NOT_FOUND", "Établissement introuvable");
  const [site, digital] = await Promise.all([siteSettings(est.id), digitalSettings(est.id)]);
  if (!site.enabled) throw new ApiError(404, "SITE_DISABLED", "Ce restaurant n'a pas activé son site");
  const menu = site.showMenu ? await siteMenu(est.id) : null;
  return { establishment: est, site, online: { enabled: digital.online.enabled, pickup: digital.online.pickup, delivery: digital.online.delivery }, menu };
}

/** Catalogue public : produits disponibles uniquement, sans coûts ni stocks. */
export async function publicCatalog(establishmentId: string) {
  const c = await getPosCatalog(establishmentId);
  return {
    categories: c.categories,
    products: c.products.filter((p) => p.isAvailable && !p.autoUnavailable).map(({ costPrice: _c, trackStock: _t, stockQty: _s, sku: _k, barcode: _b, kitchenStationId: _ks, ...p }) => p),
    menus: c.menus,
  };
}

export async function resolveTable(qrToken: string) {
  const table = await prisma.table.findUnique({ where: { qrToken }, include: { room: { select: { name: true } }, establishment: { select: estPublic } } });
  if (!table || !table.isActive) throw new ApiError(404, "NOT_FOUND", "QR code inconnu");
  return table;
}

export async function resolveEstablishment(orgSlug: string, estSlug: string) {
  const est = await prisma.establishment.findFirst({ where: { slug: estSlug, isActive: true, organization: { slug: orgSlug } }, select: estPublic });
  if (!est) throw new ApiError(404, "NOT_FOUND", "Établissement introuvable");
  return est;
}

/** Vue « menu à table » : établissement, table, mode QR, catalogue, commande en cours de la table (si mode commande). */
export async function tableMenu(qrToken: string) {
  const table = await resolveTable(qrToken);
  const settings = await digitalSettings(table.establishmentId);
  const catalog = await publicCatalog(table.establishmentId);
  const open = settings.qrMode === "ORDER" || settings.qrMode === "ORDER_DIRECT" ? await prisma.order.findFirst({ where: { tableId: table.id, status: { in: ["OPEN", "SENT", "BILL_REQUESTED"] } }, select: { id: true, number: true, status: true, total: true, publicToken: true, items: { where: { status: { not: "VOIDED" }, parentItemId: null }, select: { id: true, name: true, quantity: true, lineTotal: true, status: true, notes: true, modifiers: { select: { name: true } } } } } }) : null;
  return { establishment: table.establishment, table: { id: table.id, name: table.name, room: table.room.name, seats: table.seats, callRequestedAt: table.callRequestedAt }, mode: settings.qrMode, catalog, order: open };
}

/** Appel serveur depuis la table (mode MENU_CALL et supérieurs). */
export async function callWaiter(qrToken: string, reason?: string | null) {
  const table = await resolveTable(qrToken);
  const settings = await digitalSettings(table.establishmentId);
  if (settings.qrMode === "MENU") throw new ApiError(403, "MODE_OFF", "L'appel serveur n'est pas activé");
  await prisma.table.update({ where: { id: table.id }, data: { callRequestedAt: new Date() } });
  publish("table.updated", table.establishmentId, { tableId: table.id, call: true, reason: reason ?? null });
  return { ok: true, table: table.name };
}

export async function clearCall(actor: Actor, tableId: string) {
  const t = await prisma.table.findFirst({ where: { id: tableId, establishmentId: actor.establishmentId } });
  if (!t) throw new ApiError(404, "NOT_FOUND", "Table introuvable");
  await prisma.table.update({ where: { id: tableId }, data: { callRequestedAt: null } });
  publish("table.updated", actor.establishmentId, { tableId, call: false });
}

/** Acteur système pour les commandes créées par les clients (pas d'utilisateur connecté). */
async function systemActor(establishmentId: string): Promise<Actor> {
  const est = await prisma.establishment.findUniqueOrThrow({ where: { id: establishmentId }, select: { organizationId: true } });
  const owner = await prisma.user.findFirst({ where: { organizationId: est.organizationId, isOwner: true, isActive: true }, orderBy: { createdAt: "asc" } });
  if (!owner) throw new ApiError(500, "NO_OWNER", "Aucun propriétaire pour cet établissement");
  return { organizationId: est.organizationId, establishmentId, userId: owner.id };
}

export type PublicLine = ProductChoice & { id: string };

async function addLines(actor: Actor, orderId: string, lines: PublicLine[], courseId: string | null) {
  for (const line of lines) await addItem(actor, orderId, { ...line, courseId, seatNumber: null });
}

/** Commande depuis la table : ajoutée à la commande ouverte (ou en crée une) ; envoyée en cuisine directement (ORDER_DIRECT) ou en attente de validation (ORDER). */
export async function orderFromTable(qrToken: string, input: { id: string; lines: PublicLine[]; covers?: number; notes?: string | null }) {
  const table = await resolveTable(qrToken);
  const settings = await digitalSettings(table.establishmentId);
  if (settings.qrMode !== "ORDER" && settings.qrMode !== "ORDER_DIRECT") throw new ApiError(403, "MODE_OFF", "La commande à table n'est pas activée");
  if (input.lines.length === 0) throw new ApiError(400, "EMPTY", "Panier vide");
  const actor = await systemActor(table.establishmentId);
  const existing = await prisma.order.findFirst({ where: { id: input.id } });
  if (existing) return getOrder(table.establishmentId, existing.id);
  const order = await createOrder(actor, { type: "DINE_IN", tableId: table.id, covers: input.covers ?? table.seats, notes: input.notes ?? null });
  const course = order.courses.find((c) => c.status === "PENDING") ?? order.courses[0];
  await addLines(actor, order.id, input.lines, course?.id ?? null);
  await prisma.order.update({ where: { id: order.id }, data: { publicToken: order.publicToken ?? randomUUID(), channelMeta: { channel: "QR", table: table.name, batchId: input.id, awaitingValidation: settings.qrMode === "ORDER" } } });
  if (settings.qrMode === "ORDER_DIRECT") await sendCourse(actor, order.id, { all: true });
  publish("order.updated", table.establishmentId, { orderId: order.id, tableId: table.id, qr: true, awaitingValidation: settings.qrMode === "ORDER" });
  return getOrder(table.establishmentId, order.id);
}

export type OnlineInput = { id: string; mode: "PICKUP" | "DELIVERY"; name: string; phone: string; email?: string | null; when?: string | null; address?: string | null; zone?: string | null; notes?: string | null; lines: PublicLine[]; lang?: string };

/** Commande en ligne (click & collect ou livraison) : créée OPEN, à accepter par le restaurant ; jeton de suivi public. */
export async function createOnlineOrder(orgSlug: string, estSlug: string, input: OnlineInput) {
  const est = await resolveEstablishment(orgSlug, estSlug);
  const settings = await digitalSettings(est.id);
  if (!settings.online.enabled) throw new ApiError(403, "MODE_OFF", "La commande en ligne n'est pas ouverte");
  if (input.mode === "PICKUP" && !settings.online.pickup) throw new ApiError(403, "MODE_OFF", "Le retrait n'est pas proposé");
  if (input.mode === "DELIVERY" && !settings.online.delivery) throw new ApiError(403, "MODE_OFF", "La livraison n'est pas proposée");
  if (input.mode === "DELIVERY" && settings.online.deliveryZones.length && (!input.zone || !settings.online.deliveryZones.includes(input.zone))) throw new ApiError(400, "OUT_OF_ZONE", "Adresse hors zone de livraison");
  if (input.lines.length === 0) throw new ApiError(400, "EMPTY", "Panier vide");
  const existing = await prisma.order.findFirst({ where: { id: input.id } });
  if (existing) return trackOrder(existing.publicToken!);
  const actor = await systemActor(est.id);
  const customer = await prisma.$transaction((tx) => findOrCreatePublicCustomer(tx, est.organizationId, { name: input.name, phone: input.phone, email: input.email }));
  const order = await createOrder(actor, { id: input.id, type: input.mode === "DELIVERY" ? "DELIVERY" : "ONLINE", customerName: input.name, notes: input.notes ?? null });
  await addLines(actor, order.id, input.lines, order.courses[0]?.id ?? null);
  const fresh = await getOrder(est.id, order.id);
  if (input.mode === "DELIVERY" && fresh.subtotal < settings.online.deliveryMinOrder) { await cancelOrder(actor, order.id, "Minimum de livraison non atteint"); throw new ApiError(400, "MIN_ORDER", `Minimum de commande en livraison : ${settings.online.deliveryMinOrder} F`); }
  const token = randomUUID();
  await prisma.order.update({ where: { id: order.id }, data: { customerId: customer.id, publicToken: token, channelMeta: { channel: input.mode, name: input.name, phone: input.phone, email: input.email ?? null, when: input.when ?? null, address: input.address ?? null, zone: input.zone ?? null, deliveryFee: input.mode === "DELIVERY" ? settings.online.deliveryFee : 0, lang: input.lang ?? "fr", awaitingAcceptance: true } } });
  publish("order.created", est.id, { orderId: order.id, online: true, type: order.type });
  return trackOrder(token);
}

/** Suivi public d'une commande (jeton) : statut lisible par le client, sans données internes. */
export async function trackOrder(publicToken: string) {
  const o = await prisma.order.findUnique({ where: { publicToken }, select: { id: true, number: true, type: true, status: true, total: true, subtotal: true, discountTotal: true, openedAt: true, acceptedAt: true, closedAt: true, cancelReason: true, channelMeta: true, customerName: true, publicToken: true, table: { select: { name: true } }, establishment: { select: { name: true, phone: true, addressLine1: true, city: true, currency: true, timezone: true } }, items: { where: { status: { not: "VOIDED" }, parentItemId: null }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, quantity: true, lineTotal: true, status: true, notes: true, modifiers: { select: { name: true } } } } } });
  if (!o) throw new ApiError(404, "NOT_FOUND", "Commande introuvable");
  const meta = (o.channelMeta ?? {}) as Record<string, unknown>;
  const kitchen = o.items.map((i) => i.status);
  const stage = o.status === "CANCELLED" ? "CANCELLED" : o.status === "PAID" ? "DONE" : !o.acceptedAt && meta.awaitingAcceptance ? "RECEIVED" : kitchen.length && kitchen.every((s) => s === "READY" || s === "SERVED") ? "READY" : kitchen.some((s) => s === "PREPARING" || s === "READY") ? "PREPARING" : "ACCEPTED";
  const fee = typeof meta.deliveryFee === "number" ? meta.deliveryFee : 0;
  return { ...o, channelMeta: { channel: meta.channel ?? null, when: meta.when ?? null, address: meta.address ?? null, zone: meta.zone ?? null, deliveryFee: fee }, stage, totalWithFee: o.total + fee };
}

export async function listOnlineOrders(establishmentId: string) {
  const rows = await prisma.order.findMany({ where: { establishmentId, type: { in: ["ONLINE", "DELIVERY", "KIOSK"] }, status: { in: ["OPEN", "SENT", "BILL_REQUESTED"] } }, orderBy: { openedAt: "asc" }, select: { id: true, number: true, type: true, status: true, total: true, openedAt: true, acceptedAt: true, customerName: true, channelMeta: true, notes: true, items: { where: { status: { not: "VOIDED" }, parentItemId: null }, select: { id: true, name: true, quantity: true, status: true, notes: true, modifiers: { select: { name: true } } } } } });
  return rows.map((o) => ({ ...o, channelMeta: (o.channelMeta ?? {}) as Record<string, unknown>, awaiting: !o.acceptedAt && !!(o.channelMeta as Record<string, unknown> | null)?.awaitingAcceptance }));
}

/** Acceptation par le restaurant : envoi en cuisine et notification du client (suivi). */
export async function acceptOnlineOrder(actor: Actor, orderId: string) {
  const order = await getOrder(actor.establishmentId, orderId);
  if (order.acceptedAt) return order;
  const meta = (order.channelMeta ?? {}) as Record<string, unknown>;
  await prisma.order.update({ where: { id: orderId }, data: { acceptedAt: new Date(), channelMeta: { ...meta, awaitingAcceptance: false, awaitingValidation: false } } });
  if (order.items.some((i) => i.status === "PENDING")) await sendCourse(actor, orderId, { all: true });
  publish("order.updated", actor.establishmentId, { orderId, accepted: true });
  return getOrder(actor.establishmentId, orderId);
}

export async function rejectOnlineOrder(actor: Actor, orderId: string, reason: string) {
  return cancelOrder(actor, orderId, reason);
}

/** Borne : commande sur place ou à emporter, numéro d'appel, paiement en caisse. */
export async function createKioskOrder(establishmentId: string, terminalId: string, input: { id: string; mode: "DINE_IN" | "TAKEAWAY"; name?: string | null; lines: PublicLine[]; lang?: string }) {
  const settings = await digitalSettings(establishmentId);
  if (!settings.kiosk.enabled) throw new ApiError(403, "MODE_OFF", "La borne n'est pas activée");
  if (input.lines.length === 0) throw new ApiError(400, "EMPTY", "Panier vide");
  const existing = await prisma.order.findFirst({ where: { id: input.id } });
  if (existing) return trackOrder(existing.publicToken!);
  const actor = { ...(await systemActor(establishmentId)), terminalId };
  const order = await createOrder(actor, { id: input.id, type: "KIOSK", customerName: input.name ?? null });
  await addLines(actor, order.id, input.lines, order.courses[0]?.id ?? null);
  const token = randomUUID();
  await prisma.order.update({ where: { id: order.id }, data: { publicToken: token, acceptedAt: new Date(), channelMeta: { channel: "KIOSK", mode: input.mode, name: input.name ?? null, lang: input.lang ?? "fr", payAtCounter: true } } });
  await sendCourse(actor, order.id, { all: true });
  publish("order.created", establishmentId, { orderId: order.id, kiosk: true });
  return trackOrder(token);
}

/** QR codes des tables : URL publique par table. */
export async function tableQrList(establishmentId: string, baseUrl: string) {
  const tables = await prisma.table.findMany({ where: { establishmentId, isActive: true }, orderBy: [{ room: { sortOrder: "asc" } }, { name: "asc" }], select: { id: true, name: true, qrToken: true, room: { select: { name: true } } } });
  return tables.map((t) => ({ ...t, url: `${baseUrl}/m/${t.qrToken}` }));
}
