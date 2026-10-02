import { route, ok } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
import { audit } from "@/server/audit";
import { prisma } from "@/server/db";
import { requireBox } from "@/server/box/boxes";
import { issueBoxCertificate } from "@/server/box/certificate";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Boîtier → cloud : certificat HTTPS de son adresse (renouvelé par le boîtier un mois avant l'échéance). */
export const POST = route(async (req) => {
  const box = await requireBox(req);
  // Let's Encrypt limite les certificats par domaine : au plus 3 demandes par jour et par boîtier
  await rateLimit(`box-cert:${box.id}`, 3, 86_400_000);
  const cert = await issueBoxCertificate(box);
  const est = await prisma.establishment.findUniqueOrThrow({ where: { id: box.establishmentId }, select: { organizationId: true } });
  await audit({ organizationId: est.organizationId, establishmentId: box.establishmentId, userId: null, action: "box.certificate", entityType: "local_box", entityId: box.id, newValue: { hostname: cert.hostname, notAfter: cert.notAfter } });
  return ok(cert);
});
