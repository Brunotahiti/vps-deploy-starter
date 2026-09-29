import { route, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { clearTerminalCookie, getTerminalFromCookie } from "@/server/auth/session";
import { prisma } from "@/server/db";

export const POST = route(async () => {
  const ctx = await requirePermission("settings.manage");
  const t = await getTerminalFromCookie();
  if (t && t.establishmentId === ctx.establishment.id) await prisma.terminal.update({ where: { id: t.id }, data: { isActive: false } });
  await clearTerminalCookie();
  return ok({ unregistered: true });
});
