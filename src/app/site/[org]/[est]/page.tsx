import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadSite, pickLang, RestaurantPage, siteMetadata } from "@/components/public/restaurant-page";

export const dynamic = "force-dynamic";
type Params = Promise<{ org: string; est: string }>;
type Search = Promise<{ lang?: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { org, est } = await params;
  return siteMetadata(await loadSite(org, est));
}

/** Ancienne adresse longue du site du restaurant (toujours valable ; l'adresse de partage est déclarée officielle). */
export default async function RestaurantSitePage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const [{ org, est }, sp] = await Promise.all([params, searchParams]);
  const data = await loadSite(org, est);
  if (!data) notFound();
  return <RestaurantPage data={data} lang={pickLang(sp.lang)} />;
}
