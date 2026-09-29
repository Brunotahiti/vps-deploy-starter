export function Logo({ size = 40, withText = true, className = "" }: { size?: number; withText?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-3 ${className}`}>
      <svg width={size} height={size} viewBox="0 0 128 128" aria-hidden>
        <rect width="128" height="128" rx="28" fill="#0ea5a4" />
        <path d="M24 88c10-14 18-14 28 0s18 14 28 0 18-14 28 0" fill="none" stroke="#ecfdfb" strokeWidth="8" strokeLinecap="round" />
        <path d="M40 62V34m48 28V34M52 34v18a12 12 0 0 1-24 0V34" fill="none" stroke="#fff" strokeWidth="8" strokeLinecap="round" />
        <circle cx="88" cy="60" r="6" fill="#f97316" />
      </svg>
      {withText ? <span className="text-xl font-extrabold tracking-tight">Mana<span className="text-lagon-500">Resto</span></span> : null}
    </span>
  );
}
