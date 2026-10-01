"use client";

export function Field({ label, children, hint, className = "" }: { label: string; children: React.ReactNode; hint?: string; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export const inputClass = "h-11 w-full rounded-xl border border-line surface px-3.5 text-sm outline-none transition focus:border-lagon-500 focus:ring-4 focus:ring-lagon-500/15 disabled:opacity-60";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}
export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`min-h-[80px] w-full rounded-xl border border-line surface px-3 py-2 text-sm outline-none focus:border-lagon-500 focus:ring-2 focus:ring-lagon-500/30 ${props.className ?? ""}`} />;
}
export function Toggle({ checked, onChange, label, ariaLabel }: { checked: boolean; onChange: (v: boolean) => void; label?: string; ariaLabel?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label ? undefined : ariaLabel} onClick={() => onChange(!checked)} className="touch flex items-center gap-3">
      <span className={`relative h-7 w-12 rounded-full transition ${checked ? "bg-lagon-600" : "bg-slate-400/50"}`}>
        <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${checked ? "left-6" : "left-1"}`} />
      </span>
      {label ? <span className="text-sm font-medium">{label}</span> : null}
    </button>
  );
}
