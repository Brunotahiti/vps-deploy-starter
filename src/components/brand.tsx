/* eslint-disable @next/next/no-img-element -- logo et visuels de marque statiques (public/brand), déjà optimisés */

/** Logo officiel ManaResto (icône) + nom. */
export function Logo({ size = 40, withText = true, className = "", light = false }: { size?: number; withText?: boolean; className?: string; light?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-3 ${className}`}>
      <img src="/brand/logo.png" width={size} height={size} alt="" aria-hidden className="shrink-0 rounded-[24%] shadow-[0_6px_16px_-8px_rgb(15_110_108/0.6)]" style={{ width: size, height: size }} />
      {withText ? <span className={`text-xl font-extrabold tracking-tight ${light ? "text-white" : ""}`}>Mana<span className={light ? "text-lagon-200" : "text-brand"}>Resto</span></span> : null}
    </span>
  );
}

/**
 * Panneau de marque (connexion, inscription, invitation) : photo d'ambiance d'un restaurant face au lagon,
 * voile lagon, promesse produit et vraies captures de l'application qui flottent.
 */
export function BrandPanel() {
  return (
    <aside className="relative hidden isolate overflow-hidden p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-14">
      <img src="/brand/login-bg.webp" alt="" aria-hidden className="absolute inset-0 -z-20 h-full w-full object-cover object-[28%_center] brand-zoom" />
      <div aria-hidden className="absolute inset-0 -z-10 bg-[linear-gradient(160deg,rgb(8_58_56/0.92)_0%,rgb(11_79_77/0.86)_45%,rgb(15_110_108/0.62)_100%)]" />
      <div aria-hidden className="absolute -right-32 top-1/3 -z-10 h-96 w-96 rounded-full bg-corail-400/25 blur-3xl" />

      <div className="flex items-center justify-between">
        <Logo size={46} light />
        <span className="rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-bold backdrop-blur">🌺 Conçu et développé à Tahiti</span>
      </div>

      <div className="relative max-w-xl">
        <p className="brand-rise text-sm font-bold uppercase tracking-[0.2em] text-lagon-200">Ia ora na</p>
        <h1 className="brand-rise mt-3 text-[2.6rem] font-extrabold leading-[1.08] tracking-tight [animation-delay:.08s] xl:text-5xl">Toute la gestion de votre restaurant, <span className="text-lagon-200">dans une seule application.</span></h1>
        <div className="brand-rise mt-6 flex flex-wrap gap-2 text-sm font-semibold [animation-delay:.16s]">
          {["Caisse", "Salle", "Cuisine", "Stock", "Personnel", "Commandes en ligne"].map((t) => <span key={t} className="rounded-full border border-white/20 bg-white/10 px-3 py-1 backdrop-blur">{t}</span>)}
        </div>
        <div className="relative mt-10 h-[260px] xl:h-[300px]">
          <div className="brand-float absolute left-0 top-0 w-[82%] overflow-hidden rounded-2xl border border-white/20 bg-[#1a2633] p-1.5 pt-6 shadow-[0_40px_80px_-30px_rgb(0_0_0/0.7)]">
            <span aria-hidden className="absolute left-3 top-2 h-2.5 w-2.5 rounded-full bg-[#ff5f57] shadow-[14px_0_0_#febc2e,28px_0_0_#28c840]" />
            <img src="/brand/app-order.webp" alt="Prise de commande ManaResto avec les photos des plats" width={1100} height={688} className="w-full rounded-lg" />
          </div>
          <div className="brand-float-late absolute bottom-[-30px] right-0 w-[26%] overflow-hidden rounded-[22px] border-[5px] border-[#0f172a] bg-[#0f172a] shadow-[0_30px_60px_-20px_rgb(0_0_0/0.7)]">
            <img src="/brand/app-floor-m.webp" alt="Plan de salle ManaResto sur téléphone" width={420} height={715} className="w-full rounded-[16px]" />
          </div>
        </div>
      </div>

      <div className="relative flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-white/80">
        <span className="font-extrabold text-white">12 000 F CFP / mois</span>
        <span>0 % de commission</span>
        <span>15 jours gratuits</span>
        <span>Tablette, ordinateur, téléphone</span>
      </div>
    </aside>
  );
}

/** Bandeau de marque compact pour téléphone et tablette (au-dessus des formulaires). */
export function BrandHeaderMobile() {
  return (
    <div className="relative isolate -mx-6 -mt-6 mb-8 overflow-hidden px-6 pb-16 pt-8 text-white sm:-mx-10 sm:-mt-10 sm:px-10 lg:hidden">
      <img src="/brand/login-bg.webp" alt="" aria-hidden className="absolute inset-0 -z-20 h-full w-full object-cover object-[25%_center]" />
      <div aria-hidden className="absolute inset-0 -z-10 bg-[linear-gradient(170deg,rgb(8_58_56/0.9),rgb(15_110_108/0.78))]" />
      <div className="flex items-center justify-between"><Logo size={40} light /><span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-bold backdrop-blur">🌺 Tahiti</span></div>
      <p className="mt-6 text-2xl font-extrabold leading-tight tracking-tight">Toute la gestion de votre restaurant, <span className="text-lagon-200">dans une seule application.</span></p>
      <svg aria-hidden className="absolute inset-x-0 -bottom-px h-10 w-full" viewBox="0 0 1440 80" preserveAspectRatio="none"><path d="M0 40c160-50 320-50 480 0s320 50 480 0 320-50 480 0v40H0z" fill="var(--bg)" /></svg>
    </div>
  );
}
