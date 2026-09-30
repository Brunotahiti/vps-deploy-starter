"use client";

export function Badge({ children, color = "gray" }: { children: React.ReactNode; color?: "gray" | "green" | "orange" | "red" | "blue" | "purple" | "teal" }) {
  const c = {
    gray: "bg-slate-500/15 text-slate-600 dark:text-slate-300", green: "bg-green-500/15 text-green-700 dark:text-green-400", orange: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
    red: "bg-red-500/15 text-red-700 dark:text-red-400", blue: "bg-blue-500/15 text-blue-700 dark:text-blue-400", purple: "bg-purple-500/15 text-purple-700 dark:text-purple-400", teal: "bg-lagon-500/15 text-lagon-700 dark:text-lagon-300",
  }[color];
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ${c}`}>{children}</span>;
}

export function Spinner({ className = "" }: { className?: string }) {
  return <span className={`inline-block h-5 w-5 animate-spin rounded-full border-2 border-lagon-500/30 border-t-lagon-600 ${className}`} />;
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <p className="text-lg font-semibold">{title}</p>
      {hint ? <p className="max-w-md text-sm text-muted">{hint}</p> : null}
      {action}
    </div>
  );
}

export function Card({ children, className = "", title, action }: { children: React.ReactNode; className?: string; title?: string; action?: React.ReactNode }) {
  return (
    <section className={`card min-w-0 p-4 ${className}`}>
      {title ? (
        <header className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-wide text-muted">{title}</h3>
          {action}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function PhaseNotice({ phase, feature }: { phase: number; feature: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-line surface-2 p-6 text-center">
      <p className="text-base font-semibold">{feature}</p>
      <p className="mt-1 text-sm text-muted">Cette fonctionnalité est prévue en Phase {phase} de la feuille de route ManaResto. Elle n&apos;est pas encore disponible et n&apos;est pas simulée.</p>
    </div>
  );
}
