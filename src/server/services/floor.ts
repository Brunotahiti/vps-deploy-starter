import { prisma } from "@/server/db";
import { ApiError } from "@/server/errors";
import { publish } from "@/server/realtime/bus";
import type { RoomKind, TableShape, TableState } from "@/generated/prisma/client";

type Actor = { organizationId: string; establishmentId: string; userId: string };

export async function listRooms(establishmentId: string) {
  return prisma.room.findMany({ where: { establishmentId, isActive: true }, include: { tables: { where: { isActive: true }, orderBy: { name: "asc" } } }, orderBy: { sortOrder: "asc" } });
}

export async function upsertRoom(actor: Actor, input: { id?: string; name: string; kind?: RoomKind; sortOrder?: number; width?: number; height?: number }) {
  if (input.id) {
    const r = await prisma.room.findFirst({ where: { id: input.id, establishmentId: actor.establishmentId } });
    if (!r) throw new ApiError(404, "NOT_FOUND", "Salle introuvable");
    const room = await prisma.room.update({ where: { id: input.id }, data: { name: input.name, kind: input.kind, sortOrder: input.sortOrder, width: input.width, height: input.height } });
    publish("floor.updated", actor.establishmentId, { roomId: room.id });
    return room;
  }
  const max = await prisma.room.aggregate({ where: { establishmentId: actor.establishmentId }, _max: { sortOrder: true } });
  const room = await prisma.room.create({ data: { establishmentId: actor.establishmentId, name: input.name, kind: input.kind ?? "INDOOR", sortOrder: input.sortOrder ?? (max._max.sortOrder ?? 0) + 1, width: input.width ?? 1200, height: input.height ?? 800 } });
  publish("floor.updated", actor.establishmentId, { roomId: room.id });
  return room;
}

export async function deleteRoom(actor: Actor, id: string) {
  const r = await prisma.room.findFirst({ where: { id, establishmentId: actor.establishmentId } });
  if (!r) throw new ApiError(404, "NOT_FOUND", "Salle introuvable");
  const open = await prisma.order.count({ where: { table: { roomId: id }, status: { in: ["OPEN", "SENT", "BILL_REQUESTED"] } } });
  if (open > 0) throw new ApiError(409, "ROOM_BUSY", "Des commandes sont ouvertes dans cette salle");
  await prisma.room.update({ where: { id }, data: { isActive: false, tables: { updateMany: { where: {}, data: { isActive: false } } } } });
  publish("floor.updated", actor.establishmentId, { roomId: id });
}

export type TableInput = { id?: string; roomId: string; name: string; seats?: number; shape?: TableShape; x?: number; y?: number; width?: number; height?: number; rotation?: number };

export async function upsertTable(actor: Actor, input: TableInput) {
  const room = await prisma.room.findFirst({ where: { id: input.roomId, establishmentId: actor.establishmentId } });
  if (!room) throw new ApiError(400, "BAD_ROOM", "Salle invalide");
  const data = { roomId: input.roomId, name: input.name, seats: input.seats, shape: input.shape, x: input.x, y: input.y, width: input.width, height: input.height, rotation: input.rotation };
  let table;
  if (input.id) {
    const t = await prisma.table.findFirst({ where: { id: input.id, establishmentId: actor.establishmentId } });
    if (!t) throw new ApiError(404, "NOT_FOUND", "Table introuvable");
    table = await prisma.table.update({ where: { id: input.id }, data });
  } else {
    table = await prisma.table.create({ data: { establishmentId: actor.establishmentId, ...data, seats: input.seats ?? 2, shape: input.shape ?? "SQUARE", x: input.x ?? 40, y: input.y ?? 40, width: input.width ?? 100, height: input.height ?? 100 } });
  }
  publish("floor.updated", actor.establishmentId, { tableId: table.id });
  return table;
}

/** Sauvegarde en masse des positions (éditeur drag & drop). */
export async function saveLayout(actor: Actor, tables: { id: string; x: number; y: number; width: number; height: number; rotation: number; shape: TableShape; seats: number; name: string }[]) {
  await prisma.$transaction(tables.map((t) => prisma.table.updateMany({ where: { id: t.id, establishmentId: actor.establishmentId }, data: { x: t.x, y: t.y, width: t.width, height: t.height, rotation: t.rotation, shape: t.shape, seats: t.seats, name: t.name } })));
  publish("floor.updated", actor.establishmentId, {});
}

export async function deleteTable(actor: Actor, id: string) {
  const t = await prisma.table.findFirst({ where: { id, establishmentId: actor.establishmentId } });
  if (!t) throw new ApiError(404, "NOT_FOUND", "Table introuvable");
  const open = await prisma.order.count({ where: { tableId: id, status: { in: ["OPEN", "SENT", "BILL_REQUESTED"] } } });
  if (open > 0) throw new ApiError(409, "TABLE_BUSY", "Une commande est ouverte sur cette table");
  await prisma.table.update({ where: { id }, data: { isActive: false, name: `${t.name}·${Date.now().toString(36)}` } });
  publish("floor.updated", actor.establishmentId, { tableId: id });
}

export async function setTableState(actor: Actor, id: string, state: TableState) {
  const t = await prisma.table.findFirst({ where: { id, establishmentId: actor.establishmentId } });
  if (!t) throw new ApiError(404, "NOT_FOUND", "Table introuvable");
  const table = await prisma.table.update({ where: { id }, data: { state } });
  publish("table.updated", actor.establishmentId, { tableId: id, state });
  return table;
}

export type TableVisualStatus = "FREE" | "OCCUPIED" | "ORDERING" | "SENT" | "BILL" | "RESERVED" | "TO_CLEAN";

/** État du plan de salle : tables + commande ouverte éventuelle + statut visuel. */
export async function getFloorStatus(establishmentId: string) {
  const rooms = await listRooms(establishmentId);
  const openOrders = await prisma.order.findMany({
    where: { establishmentId, status: { in: ["OPEN", "SENT", "BILL_REQUESTED"] }, tableId: { not: null } },
    select: { id: true, tableId: true, status: true, covers: true, total: true, paidTotal: true, openedAt: true, serverId: true, server: { select: { firstName: true, displayName: true } }, _count: { select: { items: true } }, items: { where: { status: "READY" }, select: { id: true } } },
  });
  // readyCount : plats marqués PRÊT par la cuisine et pas encore servis (Phase 3)
  const byTable = new Map(openOrders.map((o) => [o.tableId!, { ...o, items: undefined, readyCount: o.items.length }]));
  return {
    rooms: rooms.map((room) => ({
      ...room,
      tables: room.tables.map((t) => {
        const order = byTable.get(t.id) ?? null;
        let status: TableVisualStatus = "FREE";
        if (order) {
          status = order.status === "BILL_REQUESTED" ? "BILL" : order.status === "SENT" ? "SENT" : order._count.items > 0 ? "ORDERING" : "OCCUPIED";
        } else if (t.state === "RESERVED") status = "RESERVED";
        else if (t.state === "TO_CLEAN") status = "TO_CLEAN";
        return { ...t, status, order };
      }),
    })),
  };
}
