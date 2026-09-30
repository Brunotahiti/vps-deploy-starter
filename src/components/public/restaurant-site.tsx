/* eslint-disable @next/next/no-img-element -- photos et logo fournis par le restaurant (URL libre) : non optimisables par next/image */
import { Phone, MapPin, Clock, CalendarDays, ShoppingBag, ExternalLink, Mail } from "lucide-react";
import { Logo } from "@/components/brand";
import { formatMoney } from "@/lib/money";
import type { restaurantSite } from "@/server/services/public";

export type SiteData = Awaited<ReturnType<typeof restaurantSite>>;
export type SiteLang = "fr" | "en" | "ty";

const L = {
  fr: { order: "Commander en ligne", reserve: "Réserver une table", call: "Appeler", menu: "Notre carte", about: "À propos", photos: "Photos", hours: "Horaires", address: "Adresse", contact: "Contact", directions: "Itinéraire", openToday: "Ouvert aujourd'hui", closedToday: "Fermé aujourd'hui", today: "aujourd'hui", closed: "Fermé", formulas: "Formules", from: "dès", powered: "Site créé avec", pickup: "À emporter", delivery: "Livraison", languages: "Langue",
    days: { mon: "Lundi", tue: "Mardi", wed: "Mercredi", thu: "Jeudi", fri: "Vendredi", sat: "Samedi", sun: "Dimanche" } },
  en: { order: "Order online", reserve: "Book a table", call: "Call", menu: "Our menu", about: "About us", photos: "Photos", hours: "Opening hours", address: "Address", contact: "Contact", directions: "Directions", openToday: "Open today", closedToday: "Closed today", today: "today", closed: "Closed", formulas: "Set menus", from: "from", powered: "Website made with", pickup: "Pickup", delivery: "Delivery", languages: "Language",
    days: { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" } },
  ty: { order: "Ani mā'a i te niuniu", reserve: "Ha'apa'o i te 'amura'a", call: "Pi'i", menu: "Tā tātou tāpura mā'a", about: "Nō mātou", photos: "Hōho'a", hours: "Hora", address: "Vāhi", contact: "Fa'aea", directions: "Purumu", openToday: "'Ua 'iriti i teie mahana", closedToday: "'Ua 'ōpani i teie mahana", today: "i teie mahana", closed: "'Ua 'ōpani", formulas: "Tāpura mā'a fa'ata'a", from: "mai", powered: "Tāmau i te", pickup: "Rave atu", delivery: "Hōpoi",  languages: "Reo",
    days: { mon: "Monirē", tue: "Mahana piti", wed: "Mahana toru", thu: "Mahana maha", fri: "Mahana pae", sat: "Mahana mā'a", sun: "Tāpati" } },
} as const;
const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
type DayKey = (typeof DAY_KEYS)[number];

/** Jour de la semaine (clé mon…sun) dans le fuseau du restaurant. */
export function todayKey(timezone: string, now = new Date()): DayKey {
  const short = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: timezone }).format(now).toLowerCase().slice(0, 3);
  return (DAY_KEYS.find((k) => k === short) ?? "mon") as DayKey;
}

/** Site public du restaurant, rendu côté serveur (référençable, sans JavaScript obligatoire). */
export function RestaurantSite({ data, lang, base }: { data: SiteData; lang: SiteLang; base: string }) {
  const t = L[lang];
  const e = data.establishment;
  const s = data.site;
  const hours = (e.openingHours ?? {}) as Partial<Record<DayKey, string[]>>;
  const today = todayKey(e.timezone);
  const todayHours = hours[today] ?? [];
  const address = [e.addressLine1, e.addressLine2, e.postalCode, e.city, e.island].filter(Boolean).join(", ");
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([e.name, address].filter(Boolean).join(" "))}`;
  const shop = `${base}/commander/${e.organization.slug}/${e.slug}`;
  const reserve = `${base}/reserver/${e.organization.slug}/${e.slug}`;
  const self = `${base}/site/${e.organization.slug}/${e.slug}`;
  const tel = e.phone ? `tel:${e.phone.replace(/[^+\d]/g, "")}` : null;
  const menu = data.menu;
  const roots = menu?.categories.filter((c) => !c.parentId) ?? [];
  const childrenOf = (id: string) => menu?.categories.filter((c) => c.parentId === id) ?? [];
  const productsIn = (id: string) => menu?.products.filter((p) => p.categoryId === id) ?? [];
  const price = (n: number) => formatMoney(n, e.currency);
  const cta = "inline-flex h-12 items-center justify-center gap-2 rounded-2xl px-5 text-sm font-extrabold shadow-lg transition active:scale-[.98]";
  return (
    <div className="min-h-dvh bg-[var(--bg)] text-[var(--text)]" style={{ ["--accent" as string]: s.accent || "#14aaa3" }}>
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_85%,transparent)] backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          {s.logoUrl ? <img src={s.logoUrl} alt="" className="h-9 w-9 rounded-xl object-cover" /> : <span className="grid h-9 w-9 place-items-center rounded-xl text-sm font-extrabold text-white" style={{ background: "var(--accent)" }}>{e.name.slice(0, 1).toUpperCase()}</span>}
          <p className="min-w-0 flex-1 truncate font-extrabold">{e.name}</p>
          <nav aria-label={t.languages} className="flex gap-1 text-xs font-bold">
            {(["fr", "en", "ty"] as const).map((l) => <a key={l} href={`${self}${l === "fr" ? "" : `?lang=${l}`}`} className={`rounded-lg px-2 py-1 uppercase ${l === lang ? "text-white" : "text-muted"}`} style={l === lang ? { background: "var(--accent)" } : undefined}>{l}</a>)}
          </nav>
        </div>
      </header>

      <section className="relative overflow-hidden text-white" data-testid="site-hero">
        {s.coverUrl ? <img src={s.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" /> : null}
        <div className="absolute inset-0" style={{ background: s.coverUrl ? "linear-gradient(180deg, rgba(0,0,0,.25), rgba(0,0,0,.7))" : "linear-gradient(160deg, color-mix(in srgb, var(--accent) 70%, #000) 0%, var(--accent) 60%, color-mix(in srgb, var(--accent) 60%, #fff) 100%)" }} />
        <div className="relative mx-auto max-w-5xl px-4 py-16 sm:py-24">
          <p className="mb-3 inline-block rounded-full bg-white/15 px-3 py-1 text-xs font-bold uppercase tracking-wider backdrop-blur">{[e.city, e.island].filter(Boolean).join(" · ") || "Polynésie française"}</p>
          <h1 className="text-4xl font-extrabold leading-tight tracking-tight sm:text-6xl">{e.name}</h1>
          {s.tagline ? <p className="mt-3 max-w-2xl text-lg text-white/90 sm:text-2xl">{s.tagline}</p> : null}
          <div className="mt-7 flex flex-wrap gap-3">
            {data.online.enabled ? <a href={shop} className={`${cta} bg-white text-slate-900`} data-testid="site-order"><ShoppingBag size={18} />{t.order}</a> : null}
            <a href={reserve} className={`${cta} bg-white/15 text-white ring-1 ring-white/40 backdrop-blur`} data-testid="site-reserve"><CalendarDays size={18} />{t.reserve}</a>
            {tel ? <a href={tel} className={`${cta} bg-white/15 text-white ring-1 ring-white/40 backdrop-blur`}><Phone size={18} />{t.call}</a> : null}
          </div>
          <p className="mt-5 inline-flex items-center gap-2 rounded-full bg-black/25 px-3 py-1.5 text-sm font-semibold backdrop-blur"><Clock size={15} />{todayHours.length ? `${t.openToday} · ${todayHours.join(", ")}` : t.closedToday}</p>
        </div>
      </section>

      <main className="mx-auto max-w-5xl px-4 pb-28 sm:pb-16">
        <section className="-mt-8 grid gap-3 sm:grid-cols-3" aria-label={t.contact}>
          <div className="card p-4"><p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted"><MapPin size={14} />{t.address}</p>{address ? <><p className="text-sm font-semibold">{address}</p><a href={mapsUrl} target="_blank" rel="noopener" className="mt-2 inline-flex items-center gap-1 text-sm font-bold" style={{ color: "var(--accent)" }}>{t.directions}<ExternalLink size={13} /></a></> : <p className="text-sm text-muted">—</p>}</div>
          <div className="card p-4"><p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted"><Clock size={14} />{t.hours}</p>
            <ul className="space-y-0.5 text-sm">{DAY_KEYS.map((k) => <li key={k} className={`flex justify-between gap-3 ${k === today ? "font-extrabold" : ""}`}><span>{t.days[k]}</span><span className={hours[k]?.length ? "" : "text-muted"}>{hours[k]?.length ? hours[k]!.join(", ") : t.closed}</span></li>)}</ul></div>
          <div className="card p-4"><p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted"><Phone size={14} />{t.contact}</p>
            <ul className="space-y-1.5 text-sm font-semibold">
              {e.phone ? <li><a href={tel!} className="inline-flex items-center gap-2"><Phone size={14} />{e.phone}</a></li> : null}
              {e.email ? <li><a href={`mailto:${e.email}`} className="inline-flex items-center gap-2"><Mail size={14} />{e.email}</a></li> : null}
              {s.facebook ? <li><a href={s.facebook} target="_blank" rel="noopener" className="inline-flex items-center gap-2">Facebook<ExternalLink size={13} /></a></li> : null}
              {s.instagram ? <li><a href={s.instagram} target="_blank" rel="noopener" className="inline-flex items-center gap-2">Instagram<ExternalLink size={13} /></a></li> : null}
              {data.online.enabled ? <li className="text-xs font-semibold text-muted">{[data.online.pickup ? t.pickup : null, data.online.delivery ? t.delivery : null].filter(Boolean).join(" · ")}</li> : null}
            </ul></div>
        </section>

        {s.description ? <section className="mt-10"><h2 className="text-2xl font-extrabold tracking-tight">{t.about}</h2><p className="mt-3 max-w-3xl whitespace-pre-line text-[15px] leading-relaxed text-muted">{s.description}</p></section> : null}

        {s.photos.length ? <section className="mt-10"><h2 className="text-2xl font-extrabold tracking-tight">{t.photos}</h2><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">{s.photos.map((u, i) => <img key={i} src={u} alt="" loading="lazy" className="aspect-[4/3] w-full rounded-2xl object-cover" />)}</div></section> : null}

        {menu ? (
          <section className="mt-10" id="menu" data-testid="site-menu">
            <h2 className="text-2xl font-extrabold tracking-tight">{t.menu}</h2>
            {roots.length > 1 ? <nav className="no-scrollbar mt-4 flex gap-2 overflow-x-auto pb-1">{roots.map((c) => <a key={c.id} href={`#cat-${c.id}`} className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm font-bold">{c.name}</a>)}</nav> : null}
            {roots.map((c) => {
              const groups = [{ id: c.id, name: null as string | null, products: productsIn(c.id) }, ...childrenOf(c.id).map((sub) => ({ id: sub.id, name: sub.name, products: productsIn(sub.id) }))].filter((g) => g.products.length);
              if (!groups.length) return null;
              return (
                <div key={c.id} id={`cat-${c.id}`} className="mt-8 scroll-mt-20">
                  <h3 className="mb-3 text-lg font-extrabold" style={{ color: "var(--accent)" }}>{c.name}</h3>
                  {groups.map((g) => (
                    <div key={g.id} className="mb-4">
                      {g.name ? <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">{g.name}</p> : null}
                      <ul className="grid gap-2 sm:grid-cols-2">
                        {g.products.map((p) => (
                          <li key={p.id} className="card flex gap-3 p-3">
                            {p.imageUrl ? <img src={p.imageUrl} alt="" loading="lazy" className="h-16 w-16 shrink-0 rounded-xl object-cover" /> : null}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-3"><p className="font-bold">{p.name}</p>{s.showPrices ? <p className="shrink-0 font-extrabold tabular-nums">{p.variants.length ? `${t.from} ${price(Math.min(p.priceTtc, ...p.variants.map((v) => v.priceTtc)))}` : price(p.priceTtc)}</p> : null}</div>
                              {p.description ? <p className="mt-0.5 text-sm text-muted">{p.description}</p> : null}
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
              <div className="mt-8">
                <h3 className="mb-3 text-lg font-extrabold" style={{ color: "var(--accent)" }}>{t.formulas}</h3>
                <ul className="grid gap-2 sm:grid-cols-2">{menu.menus.map((m) => <li key={m.id} className="card p-3"><div className="flex items-start justify-between gap-3"><p className="font-bold">{m.name}</p>{s.showPrices ? <p className="shrink-0 font-extrabold tabular-nums">{price(m.priceTtc)}</p> : null}</div>{m.description ? <p className="mt-0.5 text-sm text-muted">{m.description}</p> : null}<ul className="mt-2 space-y-0.5 text-sm text-muted">{m.sections.map((sec, i) => <li key={i}><b className="text-[var(--text)]">{sec.name} :</b> {sec.items.join(", ")}</li>)}</ul></li>)}</ul>
              </div>
            ) : null}
          </section>
        ) : null}
      </main>

      {/* Barre d'actions fixe sur mobile */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t border-[var(--border)] bg-[var(--surface)] p-3 pb-[max(12px,env(safe-area-inset-bottom))] sm:hidden">
        {data.online.enabled ? <a href={shop} className="touch flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl text-sm font-extrabold text-white" style={{ background: "var(--accent)" }}><ShoppingBag size={18} />{t.order}</a> : null}
        <a href={reserve} className={`touch flex h-12 items-center justify-center gap-2 rounded-2xl surface-2 px-4 text-sm font-extrabold ${data.online.enabled ? "" : "flex-1"}`}><CalendarDays size={18} />{t.reserve}</a>
        {tel ? <a href={tel} aria-label={t.call} className="touch grid h-12 w-12 place-items-center rounded-2xl surface-2"><Phone size={18} /></a> : null}
      </div>

      <footer className="border-t border-[var(--border)] py-8 text-center text-xs text-muted">
        <p className="font-semibold">{e.name}{address ? ` · ${address}` : ""}</p>
        <a href="https://www.manaresto.com" className="mt-3 inline-flex items-center gap-2" rel="noopener">{t.powered} <Logo size={18} /></a>
      </footer>
    </div>
  );
}
