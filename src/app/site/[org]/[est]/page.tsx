import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { restaurantSite } from "@/server/services/public";
import { RestaurantSite, type SiteLang } from "@/components/public/restaurant-site";

export const dynamic = "force-dynamic";
type Params = Promise<{ org: string; est: string }>;
type Search = Promise<{ lang?: string }>;
const base = () => process.env.PUBLIC_URL?.replace(/\/$/, "") || "";
const pickLang = (v?: string): SiteLang => (v === "en" || v === "ty" ? v : "fr");

async function load(params: Params) {
  const { org, est } = await params;
  try { return await restaurantSite(org, est); } catch { return null; }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const data = await load(params);
  if (!data) return { title: "Restaurant introuvable" };
  const e = data.establishment;
  const description = data.site.tagline || data.site.description.slice(0, 160) || `${e.name} — ${[e.city, e.island].filter(Boolean).join(", ")}`;
  return {
    title: { absolute: `${e.name}${e.city ? ` · ${e.city}` : ""}` },
    description,
    openGraph: { title: e.name, description, type: "website", locale: "fr_PF", ...(data.site.coverUrl ? { images: [data.site.coverUrl] } : {}) },
    alternates: { canonical: `${base()}/site/${e.organization.slug}/${e.slug}` },
  };
}

/** Site public propre au restaurant : présentation, horaires, contact, photos, menu et boutons commander / réserver. */
export default async function RestaurantSitePage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const [data, sp] = await Promise.all([load(params), searchParams]);
  if (!data) notFound();
  return <RestaurantSite data={data} lang={pickLang(sp.lang)} base={base()} />;
}
