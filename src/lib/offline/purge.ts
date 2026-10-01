"use client";

import { withDb } from "./db";
import { outbox } from "./outbox";

/**
 * Déconnexion / changement d'utilisateur : plus aucune donnée du compte précédent sur l'appareil
 * (profil et réponses gardés par le service worker, copies IndexedDB du catalogue, de la salle et des commandes).
 * Les opérations hors ligne non transmises sont conservées : elles appartiennent au restaurant, pas à la session.
 */
export async function purgeLocalData() {
  try { navigator.serviceWorker?.controller?.postMessage("PURGE_API"); } catch { /* sans service worker */ }
  try { await withDb((db) => db.clear("cache"), undefined); } catch { /* IndexedDB indisponible */ }
}

/** Confirmation avant déconnexion s'il reste des opérations hors ligne non transmises. */
export async function confirmLogoutWithPending(): Promise<boolean> {
  const pending = await outbox.count().catch(() => 0);
  if (pending === 0) return true;
  return window.confirm(`${pending} opération${pending > 1 ? "s" : ""} hors ligne n'${pending > 1 ? "ont" : "a"} pas encore été transmise${pending > 1 ? "s" : ""}. Elle${pending > 1 ? "s" : ""} sera${pending > 1 ? "ont" : ""} envoyée${pending > 1 ? "s" : ""} à la prochaine connexion sur cet appareil. Se déconnecter quand même ?`);
}
