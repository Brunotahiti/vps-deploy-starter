"use client";

import { getDb } from "./db";
import { outbox } from "./outbox";
import { setActivePass } from "./passes";

/**
 * Déconnexion / changement d'utilisateur : plus rien du compte précédent sur l'appareil (profil gardé par le
 * service worker, laissez-passer de l'employé ; sur un appareil personnel, copies du catalogue, de la salle et des
 * commandes). Sur un terminal du restaurant (`keepWorkingCopy`), la copie de travail reste : elle appartient au
 * restaurant, et l'employé suivant doit pouvoir travailler même sans internet.
 * Les opérations hors ligne non transmises sont toujours conservées.
 */
export async function purgeLocalData(opts: { keepWorkingCopy?: boolean } = {}) {
  try { navigator.serviceWorker?.controller?.postMessage("PURGE_API"); } catch { /* sans service worker */ }
  await setActivePass(null).catch(() => {});
  if (opts.keepWorkingCopy) {
    try { const db = await getDb(); await db?.delete("cache", "me"); } catch { /* IndexedDB indisponible */ }
    return;
  }
  try { const db = await getDb(); await db?.clear("cache"); } catch { /* IndexedDB indisponible */ }
}

/** Confirmation avant déconnexion s'il reste des opérations hors ligne non transmises. */
export async function confirmLogoutWithPending(): Promise<boolean> {
  const pending = await outbox.count().catch(() => 0);
  if (pending === 0) return true;
  return window.confirm(`${pending} opération${pending > 1 ? "s" : ""} hors ligne n'${pending > 1 ? "ont" : "a"} pas encore été transmise${pending > 1 ? "s" : ""}. Elle${pending > 1 ? "s" : ""} sera${pending > 1 ? "ont" : ""} envoyée${pending > 1 ? "s" : ""} à la prochaine connexion sur cet appareil. Se déconnecter quand même ?`);
}
