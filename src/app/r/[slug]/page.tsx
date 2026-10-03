import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolveShareSlug } from "@/server/services/share";
import { loadSite, pickLang, RestaurantPage, siteMetadata } from "@/components/public/restaurant-page";

export const dynamic = "force-dynamic";
type Params = Promise<{ slug: string }>;
type Search = Promise<{ lang?: string }>;

async function load(params: Params) {
  const { slug } = await params;
  const est = await resolveShareSlug(slug);
  return est ? loadSite(est.organization.slug, est.slug) : null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  return siteMetadata(await load(params));
}

/** Site du restaurant à son adresse de partage (manaresto.com/<adresse>, relayée ici par le site vitrine). */
export default async function SharedSitePage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const [data, sp] = await Promise.all([load(params), searchParams]);
  if (!data) notFound();
  return <RestaurantPage data={data} lang={pickLang(sp.lang)} />;
}
