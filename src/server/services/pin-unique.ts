import { prisma } from "@/server/db";
import { ApiError } from "@/server/errors";
import { verifyPin } from "@/server/auth/password";
import { reserveAttempt } from "@/server/auth/attempts";

/*
 * Un PIN identifie une personne à la caisse et au pointage : il doit être unique dans chaque établissement
 * (utilisateurs rattachés, propriétaire, fiches employés). Les PIN étant hachés, la vérification les compare un à un.
 */

/** Établissements où un utilisateur se connecte par PIN : ses rattachements, ou tous ceux de l'entreprise pour le propriétaire. */
export async function pinEstablishmentsOfUser(userId: string): Promise<string[]> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { isOwner: true, organizationId: true, memberships: { select: { establishmentId: true } } } });
  if (!u) return [];
  if (u.isOwner) return (await prisma.establishment.findMany({ where: { organizationId: u.organizationId }, select: { id: true } })).map((e) => e.id);
  return u.memberships.map((m) => m.establishmentId);
}

/**
 * Refuse un PIN déjà utilisé par quelqu'un d'autre dans ces établissements.
 * Seuls les conflits sont comptés (5 par heure et par personne qui choisit le PIN) : impossible de s'en servir
 * pour découvrir le PIN d'un collègue.
 */
export async function assertPinAvailable(pin: string, opts: { establishmentIds: string[]; userId?: string | null; employeeId?: string | null; guardKey: string }) {
  if (!opts.establishmentIds.length) return;
  const release = await reserveAttempt(`pinset:${opts.guardKey}`, 5, 60 * 60_000, "Trop de PIN déjà pris essayés : réessayez dans une heure");
  const users = await prisma.user.findMany({
    where: {
      isActive: true, pinHash: { not: null }, ...(opts.userId ? { id: { not: opts.userId } } : {}),
      OR: [{ memberships: { some: { establishmentId: { in: opts.establishmentIds } } } }, { isOwner: true, organization: { establishments: { some: { id: { in: opts.establishmentIds } } } } }],
    },
    select: { pinHash: true },
  });
  const employees = await prisma.employee.findMany({
    where: { establishmentId: { in: opts.establishmentIds }, isActive: true, pinHash: { not: null }, ...(opts.employeeId ? { id: { not: opts.employeeId } } : {}), ...(opts.userId ? { OR: [{ userId: null }, { userId: { not: opts.userId } }] } : {}) },
    select: { pinHash: true },
  });
  for (const h of [...users, ...employees]) {
    if (h.pinHash && (await verifyPin(pin, h.pinHash))) throw new ApiError(409, "PIN_TAKEN", "Ce PIN est déjà utilisé par un autre membre de l'équipe : choisissez-en un autre");
  }
  await release();
}
