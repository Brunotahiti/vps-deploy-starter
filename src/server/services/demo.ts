import { prisma } from "@/server/db";
import { ApiError } from "@/server/errors";
import { DEMO_ORG_SLUG } from "@/lib/platform";

/*
 * Compte de démonstration (identifiants publics sur la page de connexion) : on peut tout essayer,
 * mais ni envoyer d'e-mails réels (réputation de l'adresse contact@manaresto.com), ni remplir la base de photos.
 */
export async function isDemoOrganization(organizationId: string) {
  const o = await prisma.organization.findUnique({ where: { id: organizationId }, select: { slug: true } });
  return o?.slug === DEMO_ORG_SLUG;
}

export async function isDemoEstablishment(establishmentId: string) {
  const e = await prisma.establishment.findUnique({ where: { id: establishmentId }, select: { organization: { select: { slug: true } } } });
  return e?.organization.slug === DEMO_ORG_SLUG;
}

export async function assertNotDemoEmail(organizationId: string) {
  if (await isDemoOrganization(organizationId)) throw new ApiError(403, "DEMO_EMAIL_DISABLED", "L'envoi d'e-mails est désactivé sur le compte de démonstration");
}
