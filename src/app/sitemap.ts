import type { MetadataRoute } from "next";
import { prisma } from "@/server/db";
import { DEMO_ORG_SLUG } from "@/lib/platform";

export const dynamic = "force-dynamic";

const base = () => process.env.PUBLIC_URL?.replace(/\/$/, "") || "https://app.manaresto.com";

/** Pages publiques des restaurants (site activé, option Digital) : c'est leur vitrine dans Google. Le restaurant exemple n'y figure pas. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const ests = await prisma.establishment.findMany({
    where: { isActive: true, organization: { blockedAt: null, options: { has: "digital" }, slug: { not: DEMO_ORG_SLUG } } },
    select: { slug: true, settings: true, updatedAt: true, organization: { select: { slug: true } } },
  }).catch(() => []);
  return ests
    .filter((e) => ((e.settings ?? {}) as { site?: { enabled?: boolean } }).site?.enabled !== false)
    .map((e) => ({ url: `${base()}/site/${e.organization.slug}/${e.slug}`, lastModified: e.updatedAt, changeFrequency: "weekly" as const, priority: 0.8 }));
}
