import { BUILD_ID } from "@/lib/build";

/** Numéro de version installée, à côté du logo : utile pour vérifier qu'un appareil a bien la dernière mise à jour. */
export function VersionBadge({ className = "" }: { className?: string }) {
  return <span title={`Version installée : ${BUILD_ID}`} className={`inline-flex shrink-0 items-center rounded-md surface-2 px-1.5 py-0.5 font-mono text-[10px] font-bold leading-none text-muted ${className}`}>v{BUILD_ID.slice(0, 7)}</span>;
}
