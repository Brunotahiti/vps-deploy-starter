export function Logo({ size = 40, withText = true, className = "", light = false }: { size?: number; withText?: boolean; className?: string; light?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-3 ${className}`}>
      <svg width={size} height={size} viewBox="0 0 128 128" aria-hidden className="drop-shadow-sm">
        <defs><linearGradient id="mr-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#37c8bf" /><stop offset="1" stopColor="#0f6e6c" /></linearGradient></defs>
        <rect width="128" height="128" rx="30" fill="url(#mr-g)" />
        <path d="M24 88c10-14 18-14 28 0s18 14 28 0 18-14 28 0" fill="none" stroke="#eefcfa" strokeWidth="8" strokeLinecap="round" opacity="0.9" />
        <path d="M40 62V34m48 28V34M52 34v18a12 12 0 0 1-24 0V34" fill="none" stroke="#fff" strokeWidth="8" strokeLinecap="round" />
        <circle cx="88" cy="60" r="6" fill="#ff9a5c" />
      </svg>
      {withText ? <span className={`text-xl font-extrabold tracking-tight ${light ? "text-white" : ""}`}>Mana<span className={light ? "text-lagon-200" : "text-brand"}>Resto</span></span> : null}
    </span>
  );
}

/** Panneau de marque (connexion / inscription) : dégradé lagon, vagues animées, promesse produit. */
export function BrandPanel() {
  return (
    <aside className="relative hidden overflow-hidden bg-lagoon p-10 text-white lg:flex lg:flex-col lg:justify-between">
      <div className="absolute inset-x-0 bottom-0 h-40 opacity-30">
        <svg className="wave absolute bottom-0 h-40 w-[200%]" viewBox="0 0 1440 160" preserveAspectRatio="none" aria-hidden><path d="M0 80c120-40 240-40 360 0s240 40 360 0 240-40 360 0 240 40 360 0v80H0z" fill="#fff" /></svg>
      </div>
      <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/10 blur-2xl" />
      <Logo size={44} light />
      <div className="relative max-w-md">
        <p className="mb-3 inline-block rounded-full bg-white/15 px-3 py-1 text-xs font-bold uppercase tracking-wider">Polynésie française</p>
        <h1 className="text-4xl font-extrabold leading-tight tracking-tight">La caisse pensée pour les restaurants du fenua.</h1>
        <ul className="mt-6 space-y-3 text-lagon-50/90">
          <li className="flex items-start gap-3"><span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-corail-400" />F CFP sans décimales, TVA configurable, N° Tahiti sur les tickets</li>
          <li className="flex items-start gap-3"><span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-corail-400" />Fonctionne sans Internet, se synchronise au retour du réseau</li>
          <li className="flex items-start gap-3"><span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-corail-400" />Plan de salle, cuisine, caisse et statistiques en temps réel</li>
        </ul>
      </div>
      <p className="relative text-sm text-lagon-100/80">Le Mana Beach · démonstration incluse</p>
    </aside>
  );
}
