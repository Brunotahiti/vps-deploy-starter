"use client";

import { useSyncExternalStore } from "react";

/** Marque ajoutée par l'app iOS ManaResto à l'agent utilisateur de son navigateur intégré. */
export const IN_APP_MARK = "ManaRestoApp/";

const noSubscribe = () => () => {};
const inApp = () => typeof navigator !== "undefined" && navigator.userAgent.includes(IN_APP_MARK);

/**
 * Vrai quand la page est affichée dans l'app iOS : les écrans d'offre et de tarifs y sont masqués
 * (règles de l'App Store sur les achats). Même valeur côté serveur et au premier rendu : pas d'erreur d'hydratation.
 */
export function useInApp() {
  return useSyncExternalStore(noSubscribe, inApp, () => false);
}
