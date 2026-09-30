import { prisma, type Tx } from "@/server/db";
import { ApiError } from "@/server/errors";
import { audit } from "@/server/audit";
import { publish } from "@/server/realtime/bus";
import type { Prisma, ServiceReminderKind, ServiceStepStatus } from "@/generated/prisma/client";

/**
 * Suivi de service (Phase 9) : parcours d'étapes par table et rappels prioritaires pour les serveurs.
 * - Le parcours démarre à l'installation d'une table (commande sur place) ; les étapes sont configurables.
 * - Les rappels sont créés par les événements métier (envoi en cuisine, plat prêt, apporté à la table, addition)
 *   et enchaînés avec des délais réglables. Chaque validation ou report est journalisée (audit).
 * Réglages dans establishment.settings.service.
 */
type Actor = { organizationId: string; establishmentId: string; userId: string };

export type ServiceStepDef = { key: string; label: string };
export type ServiceSettings = {
  enabled: boolean;
  assignTo: "SERVER" | "TEAM";
  sound: boolean;
  vibrate: boolean;
  delays: { welcome: number; drinksCheck: number; foodCheck: number; dessertOffer: number; dessertCheck: number; bill: number; late: number };
  steps: ServiceStepDef[];
};

export const DEFAULT_STEPS: ServiceStepDef[] = [
  { key: "welcome", label: "Accueil de la table" },
  { key: "drinks_order", label: "Proposition et prise de commande des apéritifs et boissons" },
  { key: "drinks_check", label: "Vérification après le service des boissons" },
  { key: "food_order", label: "Prise de commande des plats" },
  { key: "food_check", label: "Vérification après le service des plats" },
  { key: "dessert_offer", label: "Proposition du dessert et du café" },
  { key: "dessert_order", label: "Prise de commande du dessert ou du café" },
  { key: "dessert_check", label: "Vérification après le service du dessert" },
  { key: "bill", label: "Proposition de l'addition et clôture de la table" },
];
export const DEFAULT_DELAYS: ServiceSettings["delays"] = { welcome: 2, drinksCheck: 5, foodCheck: 8, dessertOffer: 5, dessertCheck: 8, bill: 5, late: 5 };
const PRIORITY: Record<ServiceReminderKind, number> = { BRING: 1, TAKE_ORDER: 2, CHECK: 3, DESSERT: 4, BILL: 5, CUSTOM: 6 };
export const KIND_LABEL: Record<ServiceReminderKind, string> = { BRING: "Commande prête à apporter", TAKE_ORDER: "Prise de commande", CHECK: "Vérification de satisfaction", DESSERT: "Dessert ou café à proposer", BILL: "Table prête pour l'addition", CUSTOM: "Rappel" };

export async function serviceSettings(establishmentId: string, tx?: Tx): Promise<ServiceSettings> {
  const est = await (tx ?? prisma).establishment.findUniqueOrThrow({ where: { id: establishmentId }, select: { settings: true } });
  const raw = ((est.settings ?? {}) as { service?: Partial<ServiceSettings> }).service ?? {};
  const steps = Array.isArray(raw.steps) && raw.steps.length ? raw.steps.filter((s) => s && s.key && s.label).map((s) => ({ key: String(s.key), label: String(s.label) })) : DEFAULT_STEPS;
  return { enabled: raw.enabled !== false, assignTo: raw.assignTo === "TEAM" ? "TEAM" : "SERVER", sound: raw.sound !== false, vibrate: raw.vibrate !== false, delays: { ...DEFAULT_DELAYS, ...(raw.delays ?? {}) }, steps };
}

export type ServiceSettingsPatch = Partial<Omit<ServiceSettings, "delays">> & { delays?: Partial<ServiceSettings["delays"]> };
export async function updateServiceSettings(actor: Actor, patch: ServiceSettingsPatch) {
  const est = await prisma.establishment.findUniqueOrThrow({ where: { id: actor.establishmentId }, select: { settings: true } });
  const current = (est.settings ?? {}) as Record<string, unknown>;
  const prev = await serviceSettings(actor.establishmentId);
  const next: ServiceSettings = { ...prev, ...patch, delays: { ...prev.delays, ...(patch.delays ?? {}) }, steps: patch.steps?.length ? patch.steps : prev.steps };
  await prisma.establishment.update({ where: { id: actor.establishmentId }, data: { settings: { ...current, service: next } } });
  await audit({ ...actor, action: "settings.service", entityType: "establishment", entityId: actor.establishmentId, oldValue: prev, newValue: next });
  publish("service.updated", actor.establishmentId, {});
  return next;
}

/** Nature d'un service (étape de commande) d'après son nom : boissons, plats ou dessert. */
export function courseKind(name: string): "drinks" | "food" | "dessert" {
  const n = name.toLowerCase();
  if (/ap[ée]r|boisson|drink|cocktail|bar/.test(n)) return "drinks";
  if (/dessert|caf[ée]|sucr|digestif/.test(n)) return "dessert";
  return "food";
}
const minutes = (m: number) => new Date(Date.now() + m * 60_000);
const initials = (u: { firstName: string; lastName: string; displayName?: string | null } | null | undefined) => (u ? (u.displayName?.trim() ? u.displayName.trim().slice(0, 2) : `${u.firstName.slice(0, 1)}${u.lastName.slice(0, 1)}`).toUpperCase() : null);

async function createReminder(tx: Tx, data: { establishmentId: string; orderId: string; tableId: string | null; kind: ServiceReminderKind; label: string; dueAt: Date; assignedToId: string | null; ticketId?: string | null; meta?: Record<string, unknown> }) {
  return tx.serviceReminder.create({ data: { ...data, priority: PRIORITY[data.kind], meta: (data.meta ?? undefined) as Prisma.InputJsonValue | undefined, ticketId: data.ticketId ?? null } });
}
async function openReminder(tx: Tx, orderId: string, where: { stepKey?: string; ticketId?: string; kind?: ServiceReminderKind }) {
  const rows = await tx.serviceReminder.findMany({ where: { orderId, status: "OPEN", ...(where.ticketId ? { ticketId: where.ticketId } : {}), ...(where.kind ? { kind: where.kind } : {}) } });
  return rows.find((r) => !where.stepKey || (r.meta as { stepKey?: string } | null)?.stepKey === where.stepKey) ?? null;
}
async function cancelReminders(tx: Tx, orderId: string, filter?: (meta: Record<string, unknown> | null, kind: ServiceReminderKind, ticketId: string | null) => boolean) {
  const rows = await tx.serviceReminder.findMany({ where: { orderId, status: "OPEN" } });
  const ids = rows.filter((r) => !filter || filter(r.meta as Record<string, unknown> | null, r.kind, r.ticketId)).map((r) => r.id);
  if (ids.length) await tx.serviceReminder.updateMany({ where: { id: { in: ids } }, data: { status: "CANCELLED" } });
  return ids.length;
}
async function setStep(tx: Tx, orderId: string, key: string, status: ServiceStepStatus, userId: string | null, reason?: string | null) {
  const step = await tx.tableServiceStep.findUnique({ where: { orderId_key: { orderId, key } } });
  if (!step || step.status !== "PENDING") return null;
  return tx.tableServiceStep.update({ where: { id: step.id }, data: { status, doneAt: new Date(), doneById: userId, reason: reason ?? null } });
}

// ------------------------------------------------------------------ Hooks métier (appelés par orders.ts, kitchen.ts, payments)
/** Installation d'une table : création des étapes et premier rappel (accueil et boissons). */
export async function startTracking(tx: Tx, actor: Actor, order: { id: string; type: string; tableId: string | null; serverId: string | null }) {
  if (order.type !== "DINE_IN") return;
  const s = await serviceSettings(actor.establishmentId, tx);
  if (!s.enabled) return;
  const existing = await tx.tableServiceStep.count({ where: { orderId: order.id } });
  if (existing > 0) return;
  await tx.tableServiceStep.createMany({ data: s.steps.map((st, i) => ({ establishmentId: actor.establishmentId, orderId: order.id, key: st.key, label: st.label, sortOrder: i })) });
  await createReminder(tx, { establishmentId: actor.establishmentId, orderId: order.id, tableId: order.tableId, kind: "TAKE_ORDER", label: "Accueillir la table et proposer les boissons", dueAt: minutes(s.delays.welcome), assignedToId: s.assignTo === "SERVER" ? order.serverId : null, meta: { stepKey: "drinks_order", auto: true } });
}

/** Un service part en cuisine : la prise de commande correspondante est faite, le rappel associé disparaît. */
export async function onCoursesSent(tx: Tx, actor: Actor, orderId: string, courseNames: string[]) {
  const s = await serviceSettings(actor.establishmentId, tx);
  if (!s.enabled) return;
  const kinds = new Set(courseNames.map(courseKind));
  await setStep(tx, orderId, "welcome", "DONE", actor.userId);
  for (const k of kinds) await setStep(tx, orderId, `${k}_order`, "DONE", actor.userId);
  if (kinds.has("dessert")) await setStep(tx, orderId, "dessert_offer", "DONE", actor.userId);
  await cancelReminders(tx, orderId, (meta, kind) => kind === "TAKE_ORDER" && (!meta?.stepKey || [...kinds].some((k) => meta.stepKey === `${k}_order`) || (kinds.has("dessert") && meta.stepKey === "dessert_offer")) || (kind === "DESSERT" && kinds.has("dessert")));
}

/** Ticket cuisine prêt : action « à apporter » pour le serveur responsable (ou l'équipe). */
export async function onTicketReady(actor: Actor, ticket: { id: string; orderId: string; items: { name: string; quantity: number; status: string }[]; order: { tableId: string | null; serverId: string | null; type: string } }) {
  const s = await serviceSettings(actor.establishmentId);
  if (!s.enabled || ticket.order.type !== "DINE_IN") return;
  const live = ticket.items.filter((i) => i.status !== "VOIDED" && i.status !== "SERVED");
  if (live.length === 0) return;
  const label = `Apporter : ${live.map((i) => `${i.quantity > 1 ? `${i.quantity}× ` : ""}${i.name}`).join(", ").slice(0, 120)}`;
  await prisma.$transaction(async (tx) => {
    const open = await openReminder(tx, ticket.orderId, { ticketId: ticket.id });
    if (open) { await tx.serviceReminder.update({ where: { id: open.id }, data: { label, dueAt: new Date() } }); return; }
    await createReminder(tx, { establishmentId: actor.establishmentId, orderId: ticket.orderId, tableId: ticket.order.tableId, kind: "BRING", label, dueAt: new Date(), assignedToId: s.assignTo === "SERVER" ? ticket.order.serverId : null, ticketId: ticket.id });
  });
  publish("service.updated", actor.establishmentId, { orderId: ticket.orderId, tableId: ticket.order.tableId });
}

/** Ticket annulé ou repassé en préparation : plus rien à apporter pour ce ticket. */
export async function onTicketNotReady(tx: Tx, orderId: string, ticketId: string) {
  await cancelReminders(tx, orderId, (_m, kind, t) => kind === "BRING" && t === ticketId);
}

/** Apporté à la table : programme la vérification suivante selon la nature du service. */
export async function onServed(tx: Tx, actor: Actor, order: { id: string; tableId: string | null; serverId: string | null; type: string }, courseNames: string[], ticketIds: string[]) {
  const s = await serviceSettings(actor.establishmentId, tx);
  if (!s.enabled || order.type !== "DINE_IN") return;
  if (ticketIds.length) await cancelReminders(tx, order.id, (_m, kind, t) => kind === "BRING" && !!t && ticketIds.includes(t));
  const assigned = s.assignTo === "SERVER" ? order.serverId : null;
  for (const k of new Set(courseNames.map(courseKind))) {
    const stepKey = `${k}_check`;
    if (await openReminder(tx, order.id, { stepKey })) continue;
    const step = await tx.tableServiceStep.findUnique({ where: { orderId_key: { orderId: order.id, key: stepKey } } });
    if (step && step.status !== "PENDING") continue;
    const spec = k === "drinks" ? { label: "Repasser à la table : tout va bien avec les boissons ?", delay: s.delays.drinksCheck, then: "food_order" }
      : k === "food" ? { label: "Demander si tout se passe bien avec les plats", delay: s.delays.foodCheck, then: "dessert_offer" }
      : { label: "Passage de courtoisie après le dessert", delay: s.delays.dessertCheck, then: "bill" };
    await createReminder(tx, { establishmentId: actor.establishmentId, orderId: order.id, tableId: order.tableId, kind: "CHECK", label: spec.label, dueAt: minutes(spec.delay), assignedToId: assigned, meta: { stepKey, then: spec.then } });
  }
}

/** Addition demandée : l'étape « addition » est faite, plus de rappel d'addition. */
export async function onBillRequested(tx: Tx, actor: Actor, orderId: string) {
  await setStep(tx, orderId, "bill", "DONE", actor.userId);
  await cancelReminders(tx, orderId, (_m, kind) => kind === "BILL" || kind === "DESSERT" || kind === "CHECK");
}

/** Table libérée (payée ou annulée) : tous les rappels ouverts sont annulés, les étapes restent pour l'historique. */
export async function onOrderClosed(tx: Tx, orderId: string) {
  await cancelReminders(tx, orderId);
}

// ------------------------------------------------------------------ Actions serveur
async function loadReminder(establishmentId: string, id: string) {
  const r = await prisma.serviceReminder.findFirst({ where: { id, establishmentId }, include: { order: { select: { id: true, tableId: true, serverId: true, type: true, status: true } } } });
  if (!r) throw new ApiError(404, "NOT_FOUND", "Rappel introuvable");
  return r;
}

/** « Fait » : clôt le rappel, valide l'étape liée et enchaîne le rappel suivant si prévu. */
export async function completeReminder(actor: Actor, id: string) {
  const r = await loadReminder(actor.establishmentId, id);
  if (r.status !== "OPEN") return r;
  const s = await serviceSettings(actor.establishmentId);
  const meta = (r.meta ?? {}) as { stepKey?: string; then?: string };
  await prisma.$transaction(async (tx) => {
    await tx.serviceReminder.update({ where: { id }, data: { status: "DONE", doneAt: new Date(), doneById: actor.userId } });
    if (meta.stepKey) await setStep(tx, r.orderId, meta.stepKey, "DONE", actor.userId);
    if (r.kind === "BRING" && r.ticketId) {
      // « Apporté à la table » : les articles du ticket sont servis et la vérification suivante est programmée
      const ticket = await tx.kitchenTicket.findUnique({ where: { id: r.ticketId }, include: { course: { select: { name: true } }, items: { select: { id: true } } } });
      if (ticket) {
        await tx.orderItem.updateMany({ where: { kitchenTicketId: ticket.id, status: { in: ["SENT", "PREPARING", "READY"] } }, data: { status: "SERVED", servedAt: new Date() } });
        if (ticket.status !== "CANCELLED") await tx.kitchenTicket.update({ where: { id: ticket.id }, data: { status: "DONE", completedAt: ticket.completedAt ?? new Date() } });
        if (ticket.courseId) {
          const remaining = await tx.orderItem.count({ where: { courseId: ticket.courseId, status: { in: ["PENDING", "SENT", "PREPARING", "READY"] } } });
          if (remaining === 0) await tx.course.update({ where: { id: ticket.courseId }, data: { status: "SERVED" } });
        }
        await tx.order.update({ where: { id: r.orderId }, data: { version: { increment: 1 } } });
        await onServed(tx, actor, { id: r.orderId, tableId: r.order.tableId, serverId: r.order.serverId, type: r.order.type }, [ticket.course?.name ?? "PLATS"], [ticket.id]);
      }
    }
    const assigned = s.assignTo === "SERVER" ? r.order.serverId : null;
    const base = { establishmentId: actor.establishmentId, orderId: r.orderId, tableId: r.order.tableId, assignedToId: assigned };
    if (meta.then === "food_order") {
      const step = await tx.tableServiceStep.findUnique({ where: { orderId_key: { orderId: r.orderId, key: "food_order" } } });
      if (step?.status === "PENDING" && !(await openReminder(tx, r.orderId, { stepKey: "food_order" }))) await createReminder(tx, { ...base, kind: "TAKE_ORDER", label: "Prendre la commande des plats", dueAt: new Date(), meta: { stepKey: "food_order" } });
    } else if (meta.then === "dessert_offer") {
      const step = await tx.tableServiceStep.findUnique({ where: { orderId_key: { orderId: r.orderId, key: "dessert_offer" } } });
      if (step?.status === "PENDING" && !(await openReminder(tx, r.orderId, { stepKey: "dessert_offer" }))) await createReminder(tx, { ...base, kind: "DESSERT", label: "Proposer le dessert et le café", dueAt: minutes(s.delays.dessertOffer), meta: { stepKey: "dessert_offer", then: "dessert_order" } });
    } else if (meta.then === "bill") {
      const step = await tx.tableServiceStep.findUnique({ where: { orderId_key: { orderId: r.orderId, key: "bill" } } });
      if (step?.status === "PENDING" && r.order.status !== "BILL_REQUESTED" && !(await openReminder(tx, r.orderId, { stepKey: "bill" }))) await createReminder(tx, { ...base, kind: "BILL", label: "Proposer l'addition", dueAt: minutes(s.delays.bill), meta: { stepKey: "bill" } });
    }
    await audit({ ...actor, action: "service.reminder.done", entityType: "service_reminder", entityId: id, newValue: { kind: r.kind, label: r.label, orderId: r.orderId } }, tx);
  });
  publish("service.updated", actor.establishmentId, { orderId: r.orderId, tableId: r.order.tableId });
  if (r.kind === "BRING") { publish("order.updated", actor.establishmentId, { orderId: r.orderId, tableId: r.order.tableId }); publish("kitchen.updated", actor.establishmentId, { orderId: r.orderId }); }
  return loadReminder(actor.establishmentId, id);
}

/** « Reporter » : décale l'échéance, garde la trace de qui a reporté et combien de fois. */
export async function snoozeReminder(actor: Actor, id: string, minutesDelay: number) {
  const r = await loadReminder(actor.establishmentId, id);
  if (r.status !== "OPEN") throw new ApiError(409, "REMINDER_CLOSED", "Ce rappel est déjà traité");
  const m = Math.max(1, Math.min(120, Math.round(minutesDelay)));
  await prisma.$transaction(async (tx) => {
    await tx.serviceReminder.update({ where: { id }, data: { dueAt: minutes(m), snoozeCount: { increment: 1 }, snoozedById: actor.userId } });
    await audit({ ...actor, action: "service.reminder.snooze", entityType: "service_reminder", entityId: id, newValue: { minutes: m, kind: r.kind, label: r.label, orderId: r.orderId } }, tx);
  });
  publish("service.updated", actor.establishmentId, { orderId: r.orderId, tableId: r.order.tableId });
  return loadReminder(actor.establishmentId, id);
}

/** Étape marquée à la main : faite, ignorée ou non nécessaire (avec raison facultative). */
export async function setStepStatus(actor: Actor, orderId: string, key: string, status: Exclude<ServiceStepStatus, "PENDING"> | "PENDING", reason?: string | null) {
  const order = await prisma.order.findFirst({ where: { id: orderId, establishmentId: actor.establishmentId }, select: { id: true, tableId: true } });
  if (!order) throw new ApiError(404, "NOT_FOUND", "Commande introuvable");
  const step = await prisma.tableServiceStep.findUnique({ where: { orderId_key: { orderId, key } } });
  if (!step) throw new ApiError(404, "NOT_FOUND", "Étape introuvable");
  await prisma.$transaction(async (tx) => {
    await tx.tableServiceStep.update({ where: { id: step.id }, data: status === "PENDING" ? { status, doneAt: null, doneById: null, reason: null } : { status, doneAt: new Date(), doneById: actor.userId, reason: reason ?? null } });
    if (status !== "PENDING") await cancelReminders(tx, orderId, (meta) => meta?.stepKey === key);
    await audit({ ...actor, action: "service.step", entityType: "table_service_step", entityId: step.id, oldValue: { status: step.status }, newValue: { key, status, orderId }, reason: reason ?? null }, tx);
  });
  publish("service.updated", actor.establishmentId, { orderId, tableId: order.tableId });
  return prisma.tableServiceStep.findUnique({ where: { id: step.id } });
}

/** Attribue la table (sa commande) à un serveur ; les rappels ouverts suivent. */
export async function assignServer(actor: Actor, orderId: string, serverId: string | null) {
  const order = await prisma.order.findFirst({ where: { id: orderId, establishmentId: actor.establishmentId }, select: { id: true, tableId: true, serverId: true } });
  if (!order) throw new ApiError(404, "NOT_FOUND", "Commande introuvable");
  if (serverId) {
    const user = await prisma.user.findFirst({ where: { id: serverId, organizationId: actor.organizationId, isActive: true } });
    if (!user) throw new ApiError(400, "BAD_USER", "Serveur invalide");
  }
  const s = await serviceSettings(actor.establishmentId);
  await prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id: orderId }, data: { serverId, version: { increment: 1 } } });
    await tx.serviceReminder.updateMany({ where: { orderId, status: "OPEN" }, data: { assignedToId: s.assignTo === "SERVER" ? serverId : null } });
    await audit({ ...actor, action: "order.assign_server", entityType: "order", entityId: orderId, oldValue: { serverId: order.serverId }, newValue: { serverId } }, tx);
  });
  publish("order.updated", actor.establishmentId, { orderId, tableId: order.tableId });
  publish("service.updated", actor.establishmentId, { orderId, tableId: order.tableId });
  publish("table.updated", actor.establishmentId, { tableId: order.tableId });
}

// ------------------------------------------------------------------ Lectures
/** Rappels ouverts, classés : en retard d'abord, puis par priorité (à apporter, prise de commande, vérification, dessert, addition) et ancienneté. */
export async function listReminders(establishmentId: string, opts: { userId?: string | null; includeUpcoming?: boolean; all?: boolean } = {}) {
  const s = await serviceSettings(establishmentId);
  const now = Date.now();
  // Mode « serveur » : chacun voit ses tables et les rappels sans serveur ; les responsables (all) voient tout
  const rows = await prisma.serviceReminder.findMany({
    where: { establishmentId, status: "OPEN", order: { status: { in: ["OPEN", "SENT", "BILL_REQUESTED"] } }, ...(s.assignTo === "SERVER" && opts.userId && !opts.all ? { OR: [{ assignedToId: opts.userId }, { assignedToId: null }] } : {}) },
    include: { order: { select: { number: true, tableId: true, covers: true, table: { select: { name: true } }, server: { select: { id: true, firstName: true, lastName: true, displayName: true, color: true } } } } },
    orderBy: { dueAt: "asc" },
  });
  const items = rows.map((r) => {
    const waitingMin = Math.max(0, Math.floor((now - r.dueAt.getTime()) / 60_000));
    const due = r.dueAt.getTime() <= now;
    const late = due && waitingMin >= s.delays.late;
    return { id: r.id, kind: r.kind, kindLabel: KIND_LABEL[r.kind], label: r.label, priority: late ? 0 : r.priority, late, due, waitingMin, dueAt: r.dueAt, dueInMin: due ? 0 : Math.ceil((r.dueAt.getTime() - now) / 60_000), snoozeCount: r.snoozeCount, orderId: r.orderId, orderNumber: r.order.number, tableId: r.order.tableId, tableName: r.order.table?.name ?? null, covers: r.order.covers, server: r.order.server ? { id: r.order.server.id, name: r.order.server.displayName || r.order.server.firstName, initials: initials(r.order.server), color: r.order.server.color } : null, ticketId: r.ticketId, meta: (r.meta ?? {}) as Record<string, unknown> };
  });
  const sorted = items.sort((a, b) => a.priority - b.priority || a.dueAt.getTime() - b.dueAt.getTime());
  return { settings: { sound: s.sound, vibrate: s.vibrate, assignTo: s.assignTo, enabled: s.enabled, lateMin: s.delays.late }, due: sorted.filter((r) => r.due), upcoming: opts.includeUpcoming === false ? [] : sorted.filter((r) => !r.due) };
}

/** Pour le plan de salle : prochaine action par table (rappel dû le plus prioritaire) et initiales du serveur. */
export async function floorService(establishmentId: string) {
  const s = await serviceSettings(establishmentId);
  if (!s.enabled) return new Map<string, { label: string; kind: ServiceReminderKind; late: boolean; waitingMin: number; count: number }>();
  const { due } = await listReminders(establishmentId, { includeUpcoming: false });
  const byTable = new Map<string, { label: string; kind: ServiceReminderKind; late: boolean; waitingMin: number; count: number }>();
  for (const r of due) {
    if (!r.tableId) continue;
    const cur = byTable.get(r.tableId);
    if (!cur) byTable.set(r.tableId, { label: r.label, kind: r.kind, late: r.late, waitingMin: r.waitingMin, count: 1 });
    else { cur.count++; cur.late = cur.late || r.late; }
  }
  return byTable;
}

/** Chronologie d'une table : installation, envois, prêts, apportés, étapes et prochaine action recommandée. */
export async function orderTimeline(establishmentId: string, orderId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, establishmentId },
    include: { courses: { orderBy: { sortOrder: "asc" } }, items: { where: { status: { not: "VOIDED" } }, select: { id: true, name: true, quantity: true, status: true, sentAt: true, readyAt: true, servedAt: true, courseId: true, parentItemId: true } }, kitchenTickets: { select: { id: true, status: true, readyAt: true, completedAt: true, courseId: true, station: { select: { name: true } } } }, serviceSteps: { orderBy: { sortOrder: "asc" } }, serviceReminders: { orderBy: { createdAt: "asc" } }, server: { select: { id: true, firstName: true, lastName: true, displayName: true, color: true } }, table: { select: { name: true } } },
  });
  if (!order) throw new ApiError(404, "NOT_FOUND", "Commande introuvable");
  const s = await serviceSettings(establishmentId);
  type Ev = { at: Date; kind: "seated" | "sent" | "ready" | "served" | "step" | "reminder" | "bill" | "closed"; label: string; detail?: string | null };
  const events: Ev[] = [{ at: order.openedAt, kind: "seated", label: order.table ? `Installation table ${order.table.name}` : "Ouverture de la commande", detail: `${order.covers} couvert${order.covers > 1 ? "s" : ""}` }];
  for (const c of order.courses) if (c.sentAt) events.push({ at: c.sentAt, kind: "sent", label: `${c.name} envoyé en cuisine`, detail: order.items.filter((i) => i.courseId === c.id && !i.parentItemId).map((i) => `${i.quantity}× ${i.name}`).join(", ") });
  for (const t of order.kitchenTickets) if (t.readyAt) events.push({ at: t.readyAt, kind: "ready", label: `Prêt en cuisine${t.station ? ` (${t.station.name})` : ""}`, detail: order.courses.find((c) => c.id === t.courseId)?.name ?? null });
  const servedByCourse = new Map<string, Date>();
  for (const i of order.items) if (i.servedAt && !i.parentItemId) { const k = i.courseId ?? "—"; const prev = servedByCourse.get(k); if (!prev || i.servedAt > prev) servedByCourse.set(k, i.servedAt); }
  for (const [courseId, at] of servedByCourse) events.push({ at, kind: "served", label: `${order.courses.find((c) => c.id === courseId)?.name ?? "Articles"} apporté à la table` });
  for (const st of order.serviceSteps) if (st.status !== "PENDING" && st.doneAt) events.push({ at: st.doneAt, kind: "step", label: st.label, detail: st.status === "DONE" ? "fait" : st.status === "SKIPPED" ? `ignoré${st.reason ? ` · ${st.reason}` : ""}` : `non nécessaire${st.reason ? ` · ${st.reason}` : ""}` });
  for (const r of order.serviceReminders) if (r.status === "DONE" && r.doneAt) events.push({ at: r.doneAt, kind: "reminder", label: r.label, detail: "rappel validé" });
  if (order.billRequestedAt) events.push({ at: order.billRequestedAt, kind: "bill", label: "Addition demandée" });
  if (order.closedAt) events.push({ at: order.closedAt, kind: "closed", label: order.status === "PAID" ? "Table clôturée (payée)" : "Commande annulée" });
  events.sort((a, b) => a.at.getTime() - b.at.getTime());
  const open = order.serviceReminders.filter((r) => r.status === "OPEN").sort((a, b) => a.priority - b.priority || a.dueAt.getTime() - b.dueAt.getTime());
  const now = Date.now();
  const next = open[0] ? { id: open[0].id, kind: open[0].kind, label: open[0].label, dueAt: open[0].dueAt, dueInMin: Math.max(0, Math.ceil((open[0].dueAt.getTime() - now) / 60_000)), due: open[0].dueAt.getTime() <= now, late: open[0].dueAt.getTime() <= now - s.delays.late * 60_000, ticketId: open[0].ticketId } : (order.serviceSteps.find((st) => st.status === "PENDING") ? { id: null, kind: "CUSTOM" as ServiceReminderKind, label: order.serviceSteps.find((st) => st.status === "PENDING")!.label, dueAt: null, dueInMin: 0, due: false, late: false, ticketId: null } : null);
  return { enabled: s.enabled, server: order.server ? { id: order.server.id, name: order.server.displayName || `${order.server.firstName} ${order.server.lastName}`, initials: initials(order.server), color: order.server.color } : null, steps: order.serviceSteps.map((st) => ({ key: st.key, label: st.label, status: st.status, reason: st.reason, doneAt: st.doneAt })), reminders: open.map((r) => ({ id: r.id, kind: r.kind, label: r.label, dueAt: r.dueAt, due: r.dueAt.getTime() <= now, ticketId: r.ticketId })), events, next };
}
