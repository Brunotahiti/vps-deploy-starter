import { route, ok, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { prisma } from "@/server/db";
import { audit } from "@/server/audit";
import { actorFrom } from "@/server/auth/authorize";
import { terminalSettingsSchema } from "@/server/schemas";
import { terminalSettings } from "@/server/hardware/payment-terminal";

export const GET = route(async () => {
  const ctx = await requirePermission("pos.use");
  const s = await terminalSettings(ctx.establishment.id);
  return ok({ ...s, apiKey: s.apiKey ? "••••" : undefined, connected: s.adapter === "bridge" && !!s.url });
});
export const PATCH = route(async (req) => {
  const ctx = await requirePermission("settings.manage");
  const body = await parseBody(req, terminalSettingsSchema);
  const est = await prisma.establishment.findUniqueOrThrow({ where: { id: ctx.establishment.id }, select: { settings: true } });
  const current = (est.settings ?? {}) as Record<string, unknown>;
  const payments = (current.payments ?? {}) as Record<string, unknown>;
  const prev = (payments.terminal ?? {}) as Record<string, unknown>;
  const apiKey = body.apiKey && body.apiKey !== "••••" ? body.apiKey : typeof prev.apiKey === "string" ? prev.apiKey : undefined;
  const terminal: Record<string, string | number | undefined> = { adapter: body.adapter, url: body.url || undefined, terminalId: body.terminalId, timeoutMs: body.timeoutMs, apiKey };
  for (const k of Object.keys(terminal)) if (terminal[k] === undefined) delete terminal[k];
  await prisma.establishment.update({ where: { id: ctx.establishment.id }, data: { settings: { ...current, payments: { ...payments, terminal } } } });
  await audit({ ...actorFrom(ctx), action: "settings.terminal", entityType: "establishment", entityId: ctx.establishment.id, newValue: { adapter: body.adapter, url: body.url ?? null } });
  return ok({ ...(await terminalSettings(ctx.establishment.id)), apiKey: undefined });
});
