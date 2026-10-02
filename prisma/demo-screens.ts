/** Restaurant exemple : deux écrans en salle (comptoir : toute la carte ; terrasse : boissons et desserts). Créés une seule fois. */
import type { PrismaClient } from "../src/generated/prisma/client";
import { randomBytes } from "node:crypto";
import type { DemoCtx } from "./demo-activity";

export async function screensDemo(prisma: PrismaClient, ctx: DemoCtx) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { options: true } });
  if (!org.options.includes("screens")) await prisma.organization.update({ where: { id: ctx.orgId }, data: { options: [...org.options, "screens"] } });
  if (await prisma.screen.count({ where: { establishmentId: ctx.estId } })) return 0;
  const cats = await prisma.category.findMany({ where: { establishmentId: ctx.estId, name: { in: ["Boissons", "Desserts"] } }, select: { id: true } });
  await prisma.screen.createMany({ data: [
    { establishmentId: ctx.estId, name: "Comptoir", token: randomBytes(18).toString("base64url"), theme: "lagoon", headline: "Plat du jour", headlineText: "Poisson cru au lait de coco, riz blanc", headlinePrice: 1950 },
    { establishmentId: ctx.estId, name: "Terrasse", token: randomBytes(18).toString("base64url"), theme: "night", categoryIds: cats.map((c) => c.id), rotateSeconds: 10 },
  ] });
  return 2;
}
