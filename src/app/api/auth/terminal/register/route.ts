import { route, parseBody, created } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { terminalRegisterSchema } from "@/server/schemas";
import { registerTerminal } from "@/server/services/auth";
import { audit } from "@/server/audit";

export const POST = route(async (req) => {
  const ctx = await requirePermission("settings.manage");
  const body = await parseBody(req, terminalRegisterSchema);
  const t = await registerTerminal(ctx.establishment.id, body.name, body.kind);
  await audit({ organizationId: ctx.organizationId, establishmentId: ctx.establishment.id, userId: ctx.user.id, action: "terminal.register", entityType: "terminal", entityId: t.id, newValue: { name: t.name, kind: t.kind } });
  return created({ id: t.id, name: t.name, kind: t.kind });
});
