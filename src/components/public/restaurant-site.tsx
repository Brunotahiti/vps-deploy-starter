/* eslint-disable @next/next/no-img-element -- photos et logo fournis par le restaurant (URL libre) : non optimisables par next/image */
import { Photo } from "@/components/ui/photo";
import { Phone, MapPin, Clock, CalendarDays, ShoppingBag, ExternalLink, Mail, ChevronDown, UtensilsCrossed, Sparkles, Navigation, Bike, Store } from "lucide-react";
import { Logo } from "@/components/brand";
import { formatMoney } from "@/lib/money";
import type { restaurantSite } from "@/server/services/public";

export type SiteData = Awaited<ReturnType<typeof restaurantSite>>;
export type SiteLang = "fr" | "en" | "ty";

/*
 * Textes du site. Les libellés tahitiens nouveaux (statut d'ouverture, à la une, invitation finale) reprennent le
 * français tant qu'une traduction relue n'est pas disponible : mieux vaut du français qu'un tahitien approximatif.
 */
const FR = {
  order: "Commander en ligne", reserve: "Réserver une table", orderShort: "Commander", reserveShort: "Réserver", call: "Appeler", menu: "La carte", about: "Notre histoire", photos: "En images", hours: "Horaires", address: "Adresse", contact: "Contact", directions: "Itinéraire", closed: "Fermé", formulas: "Formules", from: "dès", powered: "Site créé avec", pickup: "À emporter", delivery: "Livraison", languages: "Langue",
  openNow: "Ouvert", closedNow: "Fermé", until: "jusqu'à", opensAt: "ouvre à", opensTomorrow: "ouvre demain à", opensOn: "ouvre", today: "Aujourd'hui", featured: "À la une", featuredSub: "Les assiettes que nos clients commandent le plus",
  info: "Infos pratiques", ctaTitle: "Une table vous attend", ctaText: "Réservez en quelques secondes, ou commandez pour emporter.", seeMenu: "Voir la carte", scroll: "Découvrir", onlineOrder: "Commande en ligne",
  days: { mon: "Lundi", tue: "Mardi", wed: "Mercredi", thu: "Jeudi", fri: "Vendredi", sat: "Samedi", sun: "Dimanche" },
};
type Texts = typeof FR;
const L: Record<SiteLang, Texts> = {
  fr: FR,
  en: {
    order: "Order online", reserve: "Book a table", orderShort: "Order", reserveShort: "Book", call: "Call", menu: "Our menu", about: "Our story", photos: "Gallery", hours: "Opening hours", address: "Address", contact: "Contact", directions: "Directions", closed: "Closed", formulas: "Set menus", from: "from", powered: "Website made with", pickup: "Pickup", delivery: "Delivery", languages: "Language",
    openNow: "Open", closedNow: "Closed", until: "until", opensAt: "opens at", opensTomorrow: "opens tomorrow at", opensOn: "opens", today: "Today", featured: "Signature dishes", featuredSub: "The plates our guests order the most",
    info: "Visit us", ctaTitle: "A table is waiting for you", ctaText: "Book in seconds, or order for pickup.", seeMenu: "See the menu", scroll: "Discover", onlineOrder: "Online ordering",
    days: { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" },
  },
  ty: {
    ...FR,
    order: "Ani mā'a i te niuniu", reserve: "Ha'apa'o i te 'amura'a", call: "Pi'i", menu: "Tā tātou tāpura mā'a", about: "Nō mātou", photos: "Hōho'a", hours: "Hora", address: "Vāhi", contact: "Fa'aea", directions: "Purumu", closed: "'Ua 'ōpani", formulas: "Tāpura mā'a fa'ata'a", from: "mai", powered: "Tāmau i te", pickup: "Rave atu", delivery: "Hōpoi", languages: "Reo",
    days: { mon: "Monirē", tue: "Mahana piti", wed: "Mahana toru", thu: "Mahana maha", fri: "Mahana pae", sat: "Mahana mā'a", sun: "Tāpati" },
  },
};
const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
type DayKey = (typeof DAY_KEYS)[number];

/** Jour de la semaine (clé mon…sun) dans le fuseau du restaurant. */
export function todayKey(timezone: string, now = new Date()): DayKey {
  const short = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: timezone }).format(now).toLowerCase().slice(0, 3);
  return (DAY_KEYS.find((k) => k === short) ?? "mon") as DayKey;
}

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return (h || 0) * 60 + (m || 0); };
const nowMinutes = (timezone: string, now: Date) => {
  const p = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timezone }).formatToParts(now);
  return Number(p.find((x) => x.type === "hour")?.value ?? 0) * 60 + Number(p.find((x) => x.type === "minute")?.value ?? 0);
};

export type OpenStatus = { open: true; until: string } | { open: false; next: { day: DayKey; at: string; inDays: number } | null };

/**
 * Ouvert maintenant ? Créneaux « HH:MM-HH:MM » dans le fuseau du restaurant (un créneau qui passe minuit, ex. 18:00-01:00,
 * reste ouvert après minuit). Sinon : prochaine ouverture (aujourd'hui, demain ou dans la semaine).
 */
export function openStatus(hours: Partial<Record<DayKey, string[]>>, timezone: string, now = new Date()): OpenStatus {
  const day = todayKey(timezone, now);
  const idx = DAY_KEYS.indexOf(day);
  const min = nowMinutes(timezone, now);
  const slots = (k: DayKey) => (hours[k] ?? []).map((s) => s.split("-").map((x) => x.trim())).filter((p) => p.length === 2 && p[0] && p[1]);
  for (const [a, b] of slots(day)) {
    const start = toMin(a), end = toMin(b);
    if (end > start ? min >= start && min < end : min >= start) return { open: true, until: b };
  }
  // Créneau de la veille qui déborde après minuit
  for (const [a, b] of slots(DAY_KEYS[(idx + 6) % 7])) if (toMin(b) <= toMin(a) && min < toMin(b)) return { open: true, until: b };
  for (let d = 0; d < 7; d++) {
    const k = DAY_KEYS[(idx + d) % 7];
    const next = slots(k).map(([a]) => a).filter((a) => d > 0 || toMin(a) > min).sort((x, y) => toMin(x) - toMin(y))[0];
    if (next) return { open: false, next: { day: k, at: next, inDays: d } };
  }
  return { open: false, next: null };
}

/** Site public du restaurant, rendu côté serveur (référençable, sans JavaScript obligatoire). */
export function RestaurantSite({ data, lang, base, selfUrl }: { data: SiteData; lang: SiteLang; base: string; selfUrl?: string }) {
  const t = L[lang];
  const e = data.establishment;
  const s = data.site;
  const hours = (e.openingHours ?? {}) as Partial<Record<DayKey, string[]>>;
  const today = todayKey(e.timezone);
  const status = openStatus(hours, e.timezone);
  const hm = (x: string) => (lang === "en" ? x : x.replace(":", " h "));
  const statusText = status.open
    ? `${t.openNow} · ${t.until} ${hm(status.until)}`
    : status.next
      ? `${t.closedNow} · ${status.next.inDays === 0 ? t.opensAt : status.next.inDays === 1 ? t.opensTomorrow : `${t.opensOn} ${t.days[status.next.day].toLowerCase()} ${lang === "en" ? "at" : "à"}`} ${hm(status.next.at)}`
      : t.closedNow;
  const place = [e.city, e.island].filter(Boolean).join(" · ") || "Polynésie française";
  const address = [e.addressLine1, e.addressLine2, e.postalCode, e.city, e.island].filter(Boolean).join(", ");
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([e.name, address].filter(Boolean).join(" "))}`;
  const shop = `${base}/commander/${e.organization.slug}/${e.slug}`;
  const reserve = `${base}/reserver/${e.organization.slug}/${e.slug}`;
  const self = selfUrl ?? `${base}/site/${e.organization.slug}/${e.slug}`;
  const tel = e.phone ? `tel:${e.phone.replace(/[^+\d]/g, "")}` : null;
  const menu = data.menu;
  const roots = menu?.categories.filter((c) => !c.parentId) ?? [];
  const childrenOf = (id: string) => menu?.categories.filter((c) => c.parentId === id) ?? [];
  const productsIn = (id: string) => menu?.products.filter((p) => p.categoryId === id) ?? [];
  const inRoot = (rootId: string) => [rootId, ...childrenOf(rootId).map((c) => c.id)].flatMap(productsIn);
  const price = (n: number) => formatMoney(n, e.currency);
  const fromPrice = (p: { priceTtc: number; variants: { priceTtc: number }[] }) => (p.variants.length ? `${t.from} ${price(Math.min(p.priceTtc, ...p.variants.map((v) => v.priceTtc)))}` : price(p.priceTtc));
  // « À la une » : deux plats avec photo par grande catégorie (hors boissons), six au plus
  const featured = roots.filter((c) => !/boisson|drink|bar|vin|cocktail/i.test(c.name)).flatMap((c) => inRoot(c.id).filter((p) => p.imageUrl).slice(0, 2)).slice(0, 6);
  // Avec 5 photos ou plus, les deux premières illustrent l'histoire et les suivantes forment la galerie (sans doublon)
  const aboutPhotos = s.photos.length >= 5 ? s.photos.slice(0, 2) : s.coverUrl ? [s.coverUrl] : [];
  const gallery = (s.photos.length >= 5 ? s.photos.slice(2) : s.photos).slice(0, 6);
  // Mosaïque sans trou : grande photo en tête, puis tuiles dont la largeur complète chaque rangée (4 colonnes)
  const tile = (i: number, n: number) => {
    if (n === 1) return "col-span-2 row-span-2 sm:col-span-4";
    if (n === 2) return "col-span-2 row-span-2 sm:col-span-2";
    if (i === 0) return "col-span-2 row-span-2";
    if (n === 3) return "sm:col-span-2";
    if (n === 4) return i === 3 ? "col-span-2" : "";
    if (n === 6) return i >= 3 ? "col-span-2" : "";
    return "";
  };
  const sections = [menu ? { id: "carte", label: t.menu } : null, s.description ? { id: "histoire", label: t.about } : null, gallery.length ? { id: "images", label: t.photos } : null, { id: "infos", label: t.info }].filter(Boolean) as { id: string; label: string }[];
  const btn = "inline-flex h-12 items-center justify-center gap-2 rounded-full px-6 text-sm font-extrabold transition duration-200 active:scale-[.98]";
  const eyebrow = "text-[11px] font-extrabold uppercase tracking-[0.22em]";

  return (
    <div className="site min-h-dvh bg-[var(--bg)] text-[var(--text)]" style={{ ["--accent" as string]: s.accent || "#14aaa3" }}>
      {/* En-tête : se pose sur la photo, reste accessible en défilant */}
      <header className="fixed inset-x-0 top-0 z-40 px-3 pt-[max(12px,env(safe-area-inset-top))]">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 rounded-full border border-white/15 bg-black/30 px-2 pl-2.5 text-white shadow-[0_10px_30px_-12px_rgb(0_0_0/0.5)] backdrop-blur-xl">
          <a href="#top" className="flex min-w-0 items-center gap-2.5">
            {s.logoUrl ? <img src={s.logoUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover ring-2 ring-white/30" /> : <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-extrabold text-white ring-2 ring-white/30" style={{ background: "var(--accent)" }}>{e.name.slice(0, 1).toUpperCase()}</span>}
            <span className="truncate text-[15px] font-extrabold tracking-tight">{e.name}</span>
          </a>
          <nav aria-label="Sections" className="ml-auto hidden items-center gap-1 text-sm font-semibold md:flex">
            {sections.map((x) => <a key={x.id} href={`#${x.id}`} className="rounded-full px-3 py-1.5 text-white/85 transition hover:bg-white/15 hover:text-white">{x.label}</a>)}
          </nav>
          <nav aria-label={t.languages} className="ml-auto flex shrink-0 gap-0.5 rounded-full bg-white/10 p-0.5 text-[11px] font-extrabold md:ml-1">
            {(["fr", "en", "ty"] as const).map((l) => <a key={l} href={`${self}${l === "fr" ? "" : `?lang=${l}`}`} hrefLang={l} className={`rounded-full px-2.5 py-1 uppercase transition ${l === lang ? "bg-white text-slate-900" : "text-white/80 hover:text-white"}`}>{l}</a>)}
          </nav>
          <a href={reserve} className="hidden h-10 items-center gap-2 rounded-full px-4 text-sm font-extrabold text-white shadow-lg transition hover:brightness-110 sm:inline-flex" style={{ background: "var(--accent)" }}><CalendarDays size={16} />{t.reserve}</a>
        </div>
      </header>

      {/* Héros plein écran */}
      <section id="top" className="relative isolate flex min-h-[88svh] items-end overflow-hidden text-white" data-testid="site-hero">
        {s.coverUrl ? <img src={s.coverUrl} alt="" fetchPriority="high" className="site-kenburns absolute inset-0 -z-20 h-full w-full object-cover" /> : null}
        <div className="absolute inset-0 -z-10" style={{ background: s.coverUrl ? "linear-gradient(180deg, rgb(0 0 0 / .35) 0%, rgb(0 0 0 / .05) 35%, rgb(0 0 0 / .55) 70%, rgb(0 0 0 / .82) 100%)" : "radial-gradient(120% 90% at 85% 10%, color-mix(in srgb, var(--accent) 55%, #fff) 0%, transparent 55%), linear-gradient(160deg, color-mix(in srgb, var(--accent) 65%, #000) 0%, var(--accent) 70%)" }} />
        <div className="site-rise relative mx-auto w-full max-w-6xl px-5 pb-16 pt-32 sm:pb-20">
          <p className={`${eyebrow} inline-flex items-center gap-2 text-white/85`}><MapPin size={14} />{place}</p>
          <h1 className="mt-4 max-w-4xl text-[clamp(2.75rem,8vw,6rem)] font-extrabold leading-[0.95] tracking-[-0.035em]">{e.name}</h1>
          {s.tagline ? <p className="mt-5 max-w-2xl text-lg font-medium leading-snug text-white/90 sm:text-2xl">{s.tagline}</p> : null}
          <p className="mt-6 inline-flex items-center gap-2.5 rounded-full bg-white/12 py-1.5 pl-2.5 pr-4 text-sm font-semibold ring-1 ring-white/20 backdrop-blur-md" data-testid="site-status">
            <span className={`relative flex h-2.5 w-2.5 ${status.open ? "" : "opacity-80"}`}><span className={`absolute inset-0 rounded-full ${status.open ? "animate-ping bg-emerald-400/70" : ""}`} /><span className={`relative h-2.5 w-2.5 rounded-full ${status.open ? "bg-emerald-400" : "bg-rose-400"}`} /></span>
            {statusText}
          </p>
          {/* Téléphone : deux boutons côte à côte (libellés courts) ; plus grand écran : trois boutons */}
          <div className="mt-8 flex gap-2.5 sm:flex-wrap sm:gap-3">
            {data.online.enabled ? <a href={shop} className={`${btn} flex-1 bg-white px-4 text-slate-900 shadow-[0_14px_40px_-12px_rgb(0_0_0/0.6)] hover:bg-white/90 sm:flex-none sm:px-6`} data-testid="site-order" aria-label={t.order}><ShoppingBag size={18} /><span className="sm:hidden">{t.orderShort}</span><span className="hidden sm:inline">{t.order}</span></a> : null}
            <a href={reserve} className={`${btn} flex-1 px-4 text-white shadow-[0_14px_40px_-12px_rgb(0_0_0/0.6)] hover:brightness-110 sm:flex-none sm:px-6`} style={{ background: "var(--accent)" }} data-testid="site-reserve"><CalendarDays size={18} /><span className="sm:hidden">{t.reserveShort}</span><span className="hidden sm:inline">{t.reserve}</span></a>
            {menu ? <a href="#carte" className={`${btn.replace("inline-flex ", "")} hidden bg-white/10 text-white ring-1 ring-white/35 backdrop-blur-md hover:bg-white/20 sm:inline-flex`}><UtensilsCrossed size={18} />{t.seeMenu}</a> : null}
          </div>
        </div>
        <a href={menu ? "#carte" : "#infos"} aria-label={t.scroll} className="absolute bottom-5 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-1 text-[10px] font-bold uppercase tracking-[0.25em] text-white/70 transition hover:text-white sm:flex"><span>{t.scroll}</span><ChevronDown size={18} className="site-bounce" /></a>
      </section>

      {/* Bandeau pratique, posé à cheval sur le héros */}
      <section aria-label={t.contact} className="relative z-10 mx-auto -mt-8 max-w-6xl px-4">
        <div className="grid divide-y divide-[var(--border)] overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_24px_60px_-28px_rgb(15_23_42/0.35)] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <a href="#infos" className="group flex items-center gap-4 p-5 transition hover:bg-[var(--surface-2)]">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-white" style={{ background: "var(--accent)" }}><Clock size={20} /></span>
            <span className="min-w-0"><span className={`${eyebrow} block text-muted`}>{t.today}</span><span className="block truncate font-bold">{hours[today]?.length ? hours[today]!.join(" · ") : t.closed}</span></span>
          </a>
          <a href={address ? mapsUrl : "#infos"} target={address ? "_blank" : undefined} rel="noopener" className="group flex items-center gap-4 p-5 transition hover:bg-[var(--surface-2)]">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-white" style={{ background: "var(--accent)" }}><MapPin size={20} /></span>
            <span className="min-w-0"><span className={`${eyebrow} block text-muted`}>{t.address}</span><span className="block truncate font-bold">{address || place}</span></span>
          </a>
          {tel ? (
            <a href={tel} className="group flex items-center gap-4 p-5 transition hover:bg-[var(--surface-2)]">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-white" style={{ background: "var(--accent)" }}><Phone size={20} /></span>
              <span className="min-w-0"><span className={`${eyebrow} block text-muted`}>{t.call}</span><span className="block truncate font-bold tabular-nums">{e.phone}</span></span>
            </a>
          ) : data.online.enabled ? (
            <a href={shop} className="group flex items-center gap-4 p-5 transition hover:bg-[var(--surface-2)]">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-white" style={{ background: "var(--accent)" }}><ShoppingBag size={20} /></span>
              <span className="min-w-0"><span className={`${eyebrow} block text-muted`}>{t.onlineOrder}</span><span className="block truncate font-bold">{[data.online.pickup ? t.pickup : null, data.online.delivery ? t.delivery : null].filter(Boolean).join(" · ")}</span></span>
            </a>
          ) : null}
        </div>
      </section>

      <main className="pb-28 sm:pb-0">
        {/* À la une */}
        {featured.length >= 3 ? (
          <section className="mx-auto max-w-6xl px-4 pt-20 sm:pt-24" aria-labelledby="une">
            <div className="flex items-end justify-between gap-4">
              <div><p className={eyebrow} style={{ color: "var(--accent)" }}><Sparkles size={13} className="mr-1.5 inline -translate-y-px" />{t.featured}</p><h2 id="une" className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">{t.featuredSub}</h2></div>
              {menu ? <a href="#carte" className="hidden shrink-0 text-sm font-bold sm:inline" style={{ color: "var(--accent)" }}>{t.seeMenu} →</a> : null}
            </div>
            <ul className="no-scrollbar -mx-4 mt-8 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0">
              {featured.map((p, i) => (
                <li key={p.id} className={`group relative w-[78%] shrink-0 snap-start overflow-hidden rounded-[28px] bg-[var(--surface-2)] shadow-[0_18px_44px_-24px_rgb(15_23_42/0.55)] sm:w-auto ${i === 0 ? "sm:col-span-2 sm:row-span-2" : ""}`}>
                  <div className={`relative ${i === 0 ? "aspect-[4/5] sm:aspect-auto sm:h-full sm:min-h-[460px]" : "aspect-[4/5] sm:aspect-[4/3]"}`}>
                    <Photo src={p.imageUrl} className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-[1.04]" fallback={<span className="absolute inset-0" style={{ background: "var(--accent)" }} />} />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
                    <div className="absolute inset-x-0 bottom-0 p-5 text-white">
                      <p className={`font-extrabold leading-tight tracking-tight ${i === 0 ? "text-2xl sm:text-3xl" : "text-lg"}`}>{p.name}</p>
                      {p.description && i === 0 ? <p className="mt-1.5 line-clamp-2 max-w-md text-sm text-white/85">{p.description}</p> : null}
                      {s.showPrices ? <p className="mt-3 inline-flex rounded-full bg-white/95 px-3 py-1 text-sm font-extrabold tabular-nums text-slate-900">{fromPrice(p)}</p> : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* Histoire */}
        {s.description ? (
          <section id="histoire" className="mx-auto grid max-w-6xl scroll-mt-24 items-center gap-10 px-4 pt-20 sm:pt-28 lg:grid-cols-2 lg:gap-16">
            <div>
              <p className={eyebrow} style={{ color: "var(--accent)" }}>{t.about}</p>
              {(() => {
                const [first, ...rest] = s.description.split(/\n+/);
                return <>
                  <p className="mt-4 text-2xl font-bold leading-snug tracking-tight sm:text-3xl">{first}</p>
                  {rest.length ? <p className="mt-5 whitespace-pre-line text-[16px] leading-relaxed text-muted">{rest.join("\n")}</p> : null}
                </>;
              })()}
              <div className="mt-8 flex flex-wrap gap-3">
                <a href={reserve} className={`${btn} text-white hover:brightness-110`} style={{ background: "var(--accent)" }}><CalendarDays size={18} />{t.reserve}</a>
                {address ? <a href={mapsUrl} target="_blank" rel="noopener" className={`${btn} border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-2)]`}><Navigation size={17} />{t.directions}</a> : null}
              </div>
            </div>
            {aboutPhotos.length ? (
              <div className="relative mx-auto w-full max-w-lg lg:max-w-none">
                <img src={aboutPhotos[0]} alt="" loading="lazy" className="aspect-[4/5] w-[78%] rounded-[32px] object-cover shadow-[0_30px_60px_-30px_rgb(15_23_42/0.6)]" />
                {aboutPhotos[1] ? <img src={aboutPhotos[1]} alt="" loading="lazy" className="absolute -bottom-6 right-0 aspect-square w-[48%] rounded-[28px] border-[6px] border-[var(--bg)] object-cover shadow-[0_24px_50px_-24px_rgb(15_23_42/0.6)]" /> : null}
              </div>
            ) : null}
          </section>
        ) : null}

        {/* Carte */}
        {menu ? (
          <section className="mx-auto max-w-6xl scroll-mt-24 px-4 pt-20 sm:pt-28" id="carte" data-testid="site-menu">
            <div className="text-center">
              <p className={eyebrow} style={{ color: "var(--accent)" }}>{e.name}</p>
              <h2 className="mt-2 text-4xl font-extrabold tracking-tight sm:text-5xl">{t.menu}</h2>
            </div>
            {roots.length > 1 ? (
              <nav aria-label={t.menu} className="sticky top-[76px] z-20 mt-8 flex justify-center">
                <div className="no-scrollbar flex max-w-full gap-1.5 overflow-x-auto rounded-full border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_88%,transparent)] p-1.5 shadow-[0_10px_30px_-18px_rgb(15_23_42/0.5)] backdrop-blur-xl">
                  {roots.map((c) => <a key={c.id} href={`#cat-${c.id}`} className="shrink-0 rounded-full px-4 py-2 text-sm font-bold text-muted transition hover:bg-[var(--surface-2)] hover:text-[var(--text)]">{c.name}</a>)}
                  {menu.menus.length ? <a href="#formules" className="shrink-0 rounded-full px-4 py-2 text-sm font-bold text-muted transition hover:bg-[var(--surface-2)] hover:text-[var(--text)]">{t.formulas}</a> : null}
                </div>
              </nav>
            ) : null}
            {roots.map((c) => {
              const groups = [{ id: c.id, name: null as string | null, products: productsIn(c.id) }, ...childrenOf(c.id).map((sub) => ({ id: sub.id, name: sub.name, products: productsIn(sub.id) }))].filter((g) => g.products.length);
              if (!groups.length) return null;
              return (
                <div key={c.id} id={`cat-${c.id}`} className="mt-14 scroll-mt-36">
                  <div className="mb-6 flex items-center gap-4"><h3 className="text-2xl font-extrabold tracking-tight">{c.name}</h3><span className="h-px flex-1 bg-[var(--border)]" /></div>
                  {groups.map((g) => (
                    <div key={g.id} className="mb-8">
                      {g.name ? <p className={`${eyebrow} mb-3 text-muted`}>{g.name}</p> : null}
                      <ul className="grid gap-x-10 gap-y-3 md:grid-cols-2">
                        {g.products.map((p) => (
                          <li key={p.id} className="group flex items-center gap-4 rounded-3xl p-2 transition hover:bg-[var(--surface)]">
                            <Photo src={p.imageUrl} className="h-20 w-20 shrink-0 rounded-2xl object-cover shadow-[0_10px_24px_-14px_rgb(15_23_42/0.6)] sm:h-24 sm:w-24" fallback={<span className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl text-2xl font-extrabold text-white sm:h-24 sm:w-24" style={{ background: "color-mix(in srgb, var(--accent) 80%, #fff)" }}>{p.name.slice(0, 1)}</span>} />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-baseline gap-2">
                                <p className="font-bold leading-snug">{p.name}</p>
                                {s.showPrices ? <><span aria-hidden className="mb-1 min-w-4 flex-1 border-b border-dotted border-[var(--border)]" /><p className="shrink-0 font-extrabold tabular-nums" style={{ color: "var(--accent)" }}>{fromPrice(p)}</p></> : null}
                              </div>
                              {p.description ? <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted">{p.description}</p> : null}
                              {p.variants.length && s.showPrices ? <p className="mt-1 text-xs text-muted">{p.variants.map((v) => `${v.name} ${price(v.priceTtc)}`).join(" · ")}</p> : null}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              );
            })}
            {menu.menus.length ? (
              <div id="formules" className="mt-14 scroll-mt-36">
                <div className="mb-6 flex items-center gap-4"><h3 className="text-2xl font-extrabold tracking-tight">{t.formulas}</h3><span className="h-px flex-1 bg-[var(--border)]" /></div>
                <ul className="grid gap-4 md:grid-cols-2">
                  {menu.menus.map((m) => (
                    <li key={m.id} className="relative overflow-hidden rounded-[28px] p-6 text-white shadow-[0_20px_50px_-28px_rgb(15_23_42/0.7)]" style={{ background: "linear-gradient(150deg, color-mix(in srgb, var(--accent) 80%, #000), var(--accent))" }}>
                      <span aria-hidden className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
                      <div className="relative flex items-start justify-between gap-3"><p className="text-xl font-extrabold">{m.name}</p>{s.showPrices ? <p className="shrink-0 rounded-full bg-white px-3 py-1 text-sm font-extrabold tabular-nums text-slate-900">{price(m.priceTtc)}</p> : null}</div>
                      {m.description ? <p className="relative mt-1 text-sm text-white/85">{m.description}</p> : null}
                      <ul className="relative mt-4 space-y-1.5 text-sm">{m.sections.map((sec, i) => <li key={i} className="flex gap-2"><b className="shrink-0 font-extrabold">{sec.name}</b><span className="text-white/85">{sec.items.join(" · ")}</span></li>)}</ul>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : null}

        {/* Galerie */}
        {gallery.length ? (
          <section id="images" className="mx-auto max-w-6xl scroll-mt-24 px-4 pt-20 sm:pt-28">
            <div className="text-center"><p className={eyebrow} style={{ color: "var(--accent)" }}>{place}</p><h2 className="mt-2 text-4xl font-extrabold tracking-tight sm:text-5xl">{t.photos}</h2></div>
            <div className="mt-10 grid auto-rows-[160px] grid-cols-2 gap-3 sm:auto-rows-[220px] sm:grid-cols-4">
              {gallery.map((u, i) => (
                <div key={i} className={`group overflow-hidden rounded-3xl bg-[var(--surface-2)] ${tile(i, gallery.length)}`}>
                  <img src={u} alt="" loading="lazy" className="h-full w-full object-cover transition duration-700 group-hover:scale-[1.05]" />
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* Infos pratiques */}
        <section id="infos" className="mx-auto max-w-6xl scroll-mt-24 px-4 pt-20 sm:pt-28">
          <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
            <div className="rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-6 sm:p-8">
              <p className={eyebrow} style={{ color: "var(--accent)" }}>{t.info}</p>
              <h2 className="mt-2 text-3xl font-extrabold tracking-tight">{t.hours}</h2>
              <ul className="mt-6 divide-y divide-[var(--border)]">
                {DAY_KEYS.map((k) => {
                  const isToday = k === today;
                  return (
                    <li key={k} className={`flex items-center justify-between gap-4 py-3 text-[15px] ${isToday ? "font-extrabold" : ""}`}>
                      <span className="flex items-center gap-2">{t.days[k]}{isToday ? <span className="rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-white" style={{ background: "var(--accent)" }}>{t.today}</span> : null}</span>
                      <span className={`tabular-nums ${hours[k]?.length ? "" : "text-muted"}`}>{hours[k]?.length ? hours[k]!.join("  ·  ") : t.closed}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="flex flex-col gap-4">
              <div className="rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-6 sm:p-8">
                <h2 className="text-3xl font-extrabold tracking-tight">{t.address}</h2>
                <p className="mt-3 text-[15px] leading-relaxed text-muted">{address || place}</p>
                {address ? <a href={mapsUrl} target="_blank" rel="noopener" className={`${btn} mt-5 text-white hover:brightness-110`} style={{ background: "var(--accent)" }}><Navigation size={17} />{t.directions}<ExternalLink size={14} className="opacity-70" /></a> : null}
              </div>
              <div className="rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-6 sm:p-8">
                <h2 className="text-3xl font-extrabold tracking-tight">{t.contact}</h2>
                <ul className="mt-4 space-y-3 text-[15px] font-semibold">
                  {e.phone ? <li><a href={tel!} className="inline-flex items-center gap-3 hover:underline"><span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--surface-2)]"><Phone size={16} /></span><span className="tabular-nums">{e.phone}</span></a></li> : null}
                  {e.email ? <li><a href={`mailto:${e.email}`} className="inline-flex items-center gap-3 hover:underline"><span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--surface-2)]"><Mail size={16} /></span>{e.email}</a></li> : null}
                  {s.facebook ? <li><a href={s.facebook} target="_blank" rel="noopener" className="inline-flex items-center gap-3 hover:underline"><span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--surface-2)] text-xs font-extrabold">f</span>Facebook<ExternalLink size={13} className="text-muted" /></a></li> : null}
                  {s.instagram ? <li><a href={s.instagram} target="_blank" rel="noopener" className="inline-flex items-center gap-3 hover:underline"><span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--surface-2)] text-xs font-extrabold">ig</span>Instagram<ExternalLink size={13} className="text-muted" /></a></li> : null}
                  {data.online.enabled ? <li className="flex flex-wrap gap-2 pt-1">{data.online.pickup ? <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--surface-2)] px-3 py-1 text-xs font-bold"><Store size={13} />{t.pickup}</span> : null}{data.online.delivery ? <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--surface-2)] px-3 py-1 text-xs font-bold"><Bike size={13} />{t.delivery}</span> : null}</li> : null}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* Invitation finale */}
        <section className="mx-auto max-w-6xl px-4 py-20 sm:py-28">
          <div className="relative isolate overflow-hidden rounded-[36px] px-6 py-14 text-center text-white sm:px-12 sm:py-20">
            {s.coverUrl ? <img src={s.coverUrl} alt="" loading="lazy" className="absolute inset-0 -z-20 h-full w-full object-cover" /> : null}
            <div className="absolute inset-0 -z-10" style={{ background: s.coverUrl ? "linear-gradient(160deg, color-mix(in srgb, var(--accent) 82%, transparent), rgb(0 0 0 / .78))" : "linear-gradient(160deg, color-mix(in srgb, var(--accent) 70%, #000), var(--accent))" }} />
            <h2 className="text-4xl font-extrabold tracking-tight sm:text-5xl">{t.ctaTitle}</h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-white/85">{t.ctaText}</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <a href={reserve} className={`${btn} bg-white text-slate-900 hover:bg-white/90`}><CalendarDays size={18} />{t.reserve}</a>
              {data.online.enabled ? <a href={shop} className={`${btn} bg-white/10 text-white ring-1 ring-white/40 backdrop-blur-md hover:bg-white/20`}><ShoppingBag size={18} />{t.order}</a> : null}
              {tel ? <a href={tel} className={`${btn} bg-white/10 text-white ring-1 ring-white/40 backdrop-blur-md hover:bg-white/20`}><Phone size={18} />{t.call}</a> : null}
            </div>
          </div>
        </section>
      </main>

      {/* Barre d'actions fixe sur téléphone */}
      <div className="fixed inset-x-0 bottom-0 z-30 px-3 pb-[max(12px,env(safe-area-inset-bottom))] sm:hidden">
        <div className="flex gap-2 rounded-[22px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_90%,transparent)] p-1.5 shadow-[0_18px_40px_-16px_rgb(15_23_42/0.55)] backdrop-blur-xl">
          {data.online.enabled ? <a href={shop} className="touch flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-[var(--surface-2)] text-sm font-extrabold"><ShoppingBag size={18} />{t.orderShort}</a> : null}
          <a href={reserve} className="touch flex h-12 flex-[1.4] items-center justify-center gap-2 rounded-2xl text-sm font-extrabold text-white" style={{ background: "var(--accent)" }}><CalendarDays size={18} />{t.reserve}</a>
          {tel ? <a href={tel} aria-label={t.call} className="touch grid h-12 w-12 place-items-center rounded-2xl bg-[var(--surface-2)]"><Phone size={18} /></a> : null}
        </div>
      </div>

      <footer className="border-t border-[var(--border)] bg-[var(--surface)] pb-28 pt-10 sm:pb-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-4 text-center">
          <p className="text-lg font-extrabold tracking-tight">{e.name}</p>
          {address ? <p className="text-sm text-muted">{address}</p> : null}
          <a href="https://www.manaresto.com" className="mt-2 inline-flex items-center gap-2 text-xs text-muted transition hover:text-[var(--text)]" rel="noopener">{t.powered} <Logo size={18} /></a>
        </div>
      </footer>
    </div>
  );
}
