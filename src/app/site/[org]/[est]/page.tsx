import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { restaurantSite } from "@/server/services/public";
import { DEMO_ORG_SLUG } from "@/lib/platform";
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
    // Vitrine du restaurant : indexée par Google (sauf le restaurant exemple, fictif)
    robots: e.organization.slug === DEMO_ORG_SLUG ? { index: false, follow: true } : { index: true, follow: true },
  };
}

/** Site public propre au restaurant : présentation, horaires, contact, photos, menu et boutons commander / réserver. */
export default async function RestaurantSitePage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const [data, sp] = await Promise.all([load(params), searchParams]);
  if (!data) notFound();
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(data).replace(/</g, "\\u003c") }} />
      <RestaurantSite data={data} lang={pickLang(sp.lang)} base={base()} />
    </>
  );
}

const DAY_SCHEMA = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" } as const;

/** Données structurées « Restaurant » (schema.org) : adresse, téléphone, horaires, carte, réservation — pour Google. */
function jsonLd(data: NonNullable<Awaited<ReturnType<typeof load>>>) {
  const e = data.establishment;
  const url = `${base()}/site/${e.organization.slug}/${e.slug}`;
  const abs = (u: string) => (u.startsWith("/") ? `${base()}${u}` : u);
  const hours = (e.openingHours ?? {}) as Partial<Record<keyof typeof DAY_SCHEMA, string[]>>;
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name: e.name,
    url,
    ...(data.site.description ? { description: data.site.description } : {}),
    ...(data.site.coverUrl ? { image: [abs(data.site.coverUrl), ...data.site.photos.slice(0, 3).map(abs)] } : {}),
    ...(e.phone ? { telephone: e.phone } : {}),
    address: { "@type": "PostalAddress", streetAddress: [e.addressLine1, e.addressLine2].filter(Boolean).join(", ") || undefined, postalCode: e.postalCode || undefined, addressLocality: e.city || undefined, addressRegion: e.island || undefined, addressCountry: "PF" },
    openingHoursSpecification: Object.entries(hours).flatMap(([d, slots]) => (slots ?? []).map((sl) => { const [opens, closes] = sl.split("-"); return { "@type": "OpeningHoursSpecification", dayOfWeek: DAY_SCHEMA[d as keyof typeof DAY_SCHEMA], opens, closes }; })),
    ...(data.menu ? { hasMenu: `${url}#carte` } : {}),
    acceptsReservations: true,
  });
}
