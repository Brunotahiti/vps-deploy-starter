/** Écran de transition de la gestion : un squelette de page, affiché tout de suite pendant le chargement. */
export default function AdminLoading() {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true" aria-live="polite">
      <div className="h-8 w-56 rounded-xl surface-2" />
      <div className="h-4 w-80 max-w-full rounded-lg surface-2" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-24 rounded-2xl surface-2" />)}</div>
      <div className="h-64 rounded-2xl surface-2" />
    </div>
  );
}
