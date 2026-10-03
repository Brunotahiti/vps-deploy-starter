import type { Metadata } from "next";
import { restaurantSite } from "@/server/services/public";
import { ensureShareSlug } from "@/server/services/share";
import { DEMO_ORG_SLUG } from "@/lib/platform";
import { shareUrl } from "@/lib/share";
import { RestaurantSite, type SiteData, type SiteLang } from "@/components/public/restaurant-site";

/**
 * Site public d'un restaurant, servi à deux adresses : l'adresse de partage (manaresto.com/<adresse>, relayée par le
 * site vitrine vers /r/<adresse>) et l'ancienne adresse longue (/site/<entreprise>/<établissement>). Les deux
 * déclarent l'adresse de partage comme adresse officielle (canonique) pour Google.
 */

export const appBase = () => process.env.PUBLIC_URL?.replace(/\/$/, "") || "";
export const pickLang = (v?: string): SiteLang => (v === "en" || v === "ty" ? v : "fr");

export async function loadSite(orgSlug: string, estSlug: string) {
  let data: SiteData;
  try { data = await restaurantSite(orgSlug, estSlug); } catch { return null; }
  // Établissement créé avant les adresses de partage : la sienne est attribuée maintenant
  if (!data.establishment.shareSlug) data = { ...data, establishment: { ...data.establishment, shareSlug: await ensureShareSlug(data.establishment.id) } };
  return absolutize(data);
}

/** Les photos envoyées (/api/uploads/…) deviennent des adresses complètes : la page s'affiche aussi sous manaresto.com. */
function absolutize(data: SiteData): SiteData {
  const abs = (u: string) => (u.startsWith("/") ? `${appBase()}${u}` : u);
  const absN = (u: string | null) => (u ? abs(u) : u);
  return {
    ...data,
    site: { ...data.site, coverUrl: abs(data.site.coverUrl), logoUrl: abs(data.site.logoUrl), photos: data.site.photos.map(abs) },
    menu: data.menu ? { ...data.menu, products: data.menu.products.map((p) => ({ ...p, imageUrl: absN(p.imageUrl) })), menus: data.menu.menus.map((m) => ({ ...m, imageUrl: absN(m.imageUrl) })) } : null,
  };
}

/** Adresse officielle du site : l'adresse de partage, sinon l'adresse longue. */
export const canonicalUrl = (data: SiteData) => (data.establishment.shareSlug ? shareUrl(data.establishment.shareSlug) : `${appBase()}/site/${data.establishment.organization.slug}/${data.establishment.slug}`);

export function siteMetadata(data: SiteData | null): Metadata {
  if (!data) return { title: "Restaurant introuvable" };
  const e = data.establishment;
  const description = data.site.tagline || data.site.description.slice(0, 160) || `${e.name} — ${[e.city, e.island].filter(Boolean).join(", ")}`;
  const url = canonicalUrl(data);
  // Aperçu du lien partagé (WhatsApp, Facebook, Messenger…) : carte avec la photo, le nom et la ville du restaurant
  const image = e.shareSlug ? `${appBase()}/api/public/share-card/${e.shareSlug}` : data.site.coverUrl || undefined;
  const title = `${e.name}${e.city ? ` · ${e.city}` : ""}`;
  return {
    title: { absolute: title },
    description,
    openGraph: { title, description, url, siteName: e.name, type: "website", locale: "fr_PF", ...(image ? { images: [{ url: image, width: 1200, height: 630, alt: e.name }] } : {}) },
    twitter: { card: "summary_large_image", title, description, ...(image ? { images: [image] } : {}) },
    alternates: { canonical: url },
    // Vitrine du restaurant : indexée par Google (sauf le restaurant exemple, fictif)
    robots: e.organization.slug === DEMO_ORG_SLUG ? { index: false, follow: true } : { index: true, follow: true },
  };
}

export function RestaurantPage({ data, lang }: { data: SiteData; lang: SiteLang }) {
  const url = canonicalUrl(data);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(data, url).replace(/</g, "\\u003c") }} />
      <RestaurantSite data={data} lang={lang} base={appBase()} selfUrl={url} />
    </>
  );
}

const DAY_SCHEMA = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" } as const;

/** Données structurées « Restaurant » (schema.org) : adresse, téléphone, horaires, carte, réservation — pour Google. */
function jsonLd(data: SiteData, url: string) {
  const e = data.establishment;
  const hours = (e.openingHours ?? {}) as Partial<Record<keyof typeof DAY_SCHEMA, string[]>>;
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name: e.name,
    url,
    ...(data.site.description ? { description: data.site.description } : {}),
    ...(data.site.coverUrl ? { image: [data.site.coverUrl, ...data.site.photos.slice(0, 3)] } : {}),
    ...(e.phone ? { telephone: e.phone } : {}),
    address: { "@type": "PostalAddress", streetAddress: [e.addressLine1, e.addressLine2].filter(Boolean).join(", ") || undefined, postalCode: e.postalCode || undefined, addressLocality: e.city || undefined, addressRegion: e.island || undefined, addressCountry: "PF" },
    openingHoursSpecification: Object.entries(hours).flatMap(([d, slots]) => (slots ?? []).map((sl) => { const [opens, closes] = sl.split("-"); return { "@type": "OpeningHoursSpecification", dayOfWeek: DAY_SCHEMA[d as keyof typeof DAY_SCHEMA], opens, closes }; })),
    ...(data.menu ? { hasMenu: `${url}#carte` } : {}),
    acceptsReservations: true,
  });
}
