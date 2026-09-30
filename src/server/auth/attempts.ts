import { ApiError } from "@/server/errors";

/*
 * Limitation des tentatives (mot de passe, PIN) à fenêtre glissante.
 * La tentative est RÉSERVÉE avant la vérification (les requêtes parallèles ne passent pas toutes),
 * et un succès ne libère que SA réservation : le bon PIN d'un employé ne remet pas à zéro
 * le compteur d'un autre qui cherche à deviner un PIN.
 */
const windows = new Map<string, number[]>();
let lastSweep = Date.now();

function sweep(now: number) {
  if (now - lastSweep < 60_000 && windows.size < 20_000) return;
  lastSweep = now;
  for (const [k, list] of windows) if (!list.length || list[list.length - 1] < now - 3_600_000) windows.delete(k);
}

/** Réserve une tentative ; lève 429 si la limite est atteinte. Retourne la fonction à appeler en cas de succès. */
export function reserveAttempt(key: string, limit: number, windowMs: number, message = "Trop de tentatives, réessayez dans quelques minutes"): () => void {
  const now = Date.now();
  sweep(now);
  const list = (windows.get(key) ?? []).filter((t) => t > now - windowMs);
  if (list.length >= limit) {
    windows.set(key, list);
    throw new ApiError(429, "RATE_LIMITED", message, { retryAfter: Math.ceil((list[0] + windowMs - now) / 1000) });
  }
  const stamp = now + Math.random() / 1000; // unique pour pouvoir libérer exactement cette tentative
  list.push(stamp);
  windows.set(key, list);
  return () => {
    const l = windows.get(key);
    const i = l ? l.indexOf(stamp) : -1;
    if (l && i >= 0) l.splice(i, 1);
  };
}

/** Pour les tests : vide les compteurs. */
export function resetAttempts() {
  windows.clear();
}
