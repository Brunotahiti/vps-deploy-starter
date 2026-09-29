/**
 * HardwareAdapter — abstraction des périphériques (imprimante, tiroir, afficheur, lecteur, TPE).
 * ManaResto ne dépend d'aucun matériel propriétaire : chaque périphérique est un
 * adaptateur implémentant cette interface. Phase 2 : construction des flux ESC/POS
 * et impression navigateur ; les transports réseau/USB/Bluetooth sont branchés en Phase 7.
 */
export interface PrinterAdapter {
  readonly kind: "escpos-network" | "escpos-usb" | "escpos-bluetooth" | "browser";
  /** Envoie un flux d'octets ESC/POS. */
  print(payload: Uint8Array): Promise<void>;
  openDrawer?(): Promise<void>;
}

export interface PaymentTerminalAdapter {
  readonly provider: string;
  /** Lance une transaction sur un TPE externe ; retourne la référence de transaction. */
  charge(amountMinor: number, currency: string, reference: string): Promise<{ ok: boolean; providerRef?: string; message?: string }>;
  refund(providerRef: string, amountMinor: number): Promise<{ ok: boolean; message?: string }>;
}

/** Registre des adaptateurs disponibles (aucun transport réel n'est actif pour l'instant). */
export const printerAdapters: Record<string, () => PrinterAdapter | null> = {
  browser: () => null, // impression via la page HTML /api/orders/:id/receipt (window.print)
  "escpos-network": () => null, // prévu Phase 7 : socket TCP 9100 depuis un agent local
};

export const paymentAdapters: Record<string, () => PaymentTerminalAdapter | null> = {
  external: () => null, // TPE externe : le serveur saisit le montant et enregistre la référence
};
