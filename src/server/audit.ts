import { prisma, type Tx } from "@/server/db";

export type AuditInput = {
  organizationId: string;
  establishmentId?: string | null;
  userId?: string | null;
  authorizedById?: string | null;
  terminalId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
  ip?: string | null;
};

function toJson(v: unknown) {
  if (v === undefined || v === null) return undefined;
  return JSON.parse(JSON.stringify(v));
}

/** Journal d'audit : écriture seule, jamais modifiable via l'API. */
export async function audit(input: AuditInput, tx?: Tx) {
  const db = tx ?? prisma;
  return db.auditLog.create({
    data: {
      organizationId: input.organizationId,
      establishmentId: input.establishmentId ?? null,
      userId: input.userId ?? null,
      authorizedById: input.authorizedById ?? null,
      terminalId: input.terminalId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      oldValue: toJson(input.oldValue),
      newValue: toJson(input.newValue),
      reason: input.reason ?? null,
      ip: input.ip ?? null,
    },
  });
}
