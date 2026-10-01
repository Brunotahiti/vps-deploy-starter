"use client";

import { useState } from "react";

/**
 * Photo du catalogue (adresse libre) : si elle ne se charge pas (site d'images en panne, lien mort, hors ligne),
 * l'emplacement de secours s'affiche à la place de l'icône d'image cassée.
 */
export function Photo({ src, className = "", fallback }: { src: string | null | undefined; className?: string; fallback: React.ReactNode }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || failed === src) return <>{fallback}</>;
  // eslint-disable-next-line @next/next/no-img-element -- images du catalogue (URL libre), non optimisables
  return <img src={src} alt="" loading="lazy" className={className} onError={() => setFailed(src)} />;
}
