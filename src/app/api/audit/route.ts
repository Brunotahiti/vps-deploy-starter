import { z } from "zod";
import { route, parseQuery, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { prisma } from "@/server/db";

export const GET = route(async (req) => {
  const ctx = await requirePermission("audit.view");
  const q = parseQuery(req, z.object({ take: z.coerce.number().int().min(1).max(200).default(50), skip: z.coerce.number().int().min(0).default(0), action: z.string().optional() }));
  const where = { establishmentId: ctx.establishment.id, ...(q.action ? { action: { startsWith: q.action } } : {}) };
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: q.take, skip: q.skip, include: { user: { select: { firstName: true, lastName: true, displayName: true } }, terminal: { select: { name: true } } } }),
    prisma.auditLog.count({ where }),
  ]);
  return ok({ items, total });
});
