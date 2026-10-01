import { route, ok } from "@/server/http";
import { getAuthContext } from "@/server/auth/context";
import { getTerminalFromCookie } from "@/server/auth/session";
import { isEmailConfigured } from "@/server/email/mailer";
import { prisma } from "@/server/db";
import { subscriptionInfo } from "@/lib/plan";
import { isPlatformAdminEmail } from "@/server/auth/platform";
import { publicEstablishment } from "@/server/services/establishments";

export const GET = route(async () => {
  const ctx = await getAuthContext();
  const terminal = await getTerminalFromCookie();
  if (!ctx) return ok({ user: null, terminal: terminal ? { id: terminal.id, name: terminal.name, kind: terminal.kind, establishmentId: terminal.establishmentId, establishmentName: terminal.establishmentName } : null });
  const { user, establishment } = ctx;
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { plan: true, trialEndsAt: true } });
  return ok({
    subscription: subscriptionInfo(org),
    user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, displayName: user.displayName, color: user.color, isOwner: user.isOwner, hasPin: !!user.pinHash },
    organizationId: ctx.organizationId,
    establishment: establishment ? publicEstablishment(establishment) : null,
    establishments: ctx.establishments,
    roleKey: ctx.roleKey,
    permissions: [...ctx.permissions],
    terminal: ctx.terminal ? { id: ctx.terminal.id, name: ctx.terminal.name, kind: ctx.terminal.kind, establishmentId: ctx.terminal.establishmentId } : null,
    features: { email: isEmailConfigured() },
    platformAdmin: !ctx.impersonatorId && isPlatformAdminEmail(user.email),
    impersonation: ctx.impersonatorId ? { by: (await prisma.user.findUnique({ where: { id: ctx.impersonatorId }, select: { email: true } }))?.email ?? "support" } : null,
  });
});
