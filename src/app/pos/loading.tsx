import { Spinner } from "@/components/ui/misc";

/** Écran de transition de la caisse : affiché tout de suite pendant que la page suivante se charge. */
export default function PosLoading() {
  return <div className="flex min-h-[60vh] items-center justify-center" aria-busy="true" aria-live="polite"><Spinner className="h-8 w-8" /></div>;
}
