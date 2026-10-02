"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { NumPad } from "@/components/ui/numpad";
import { ApiClientError } from "@/lib/api-client";
import { localCan, offlineAllowed, withOfflineAuth } from "@/lib/offline/auth-state";
import { unlockWithPin } from "@/lib/offline/passes";
import { PERMISSIONS, type PermissionKey } from "@/lib/permissions";

export type PinRequest = { permission: PermissionKey; run: (managerPin: string) => Promise<unknown>; cancel?: () => void } | null;

/** Demande de PIN manager pour une opération sensible, puis relance l'opération. */
export function PinModal({ request, onClose }: { request: PinRequest; onClose: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const submit = async () => {
    if (!request || pin.length < 4) return;
    setLoading(true);
    setError(null);
    try {
      await request.run(pin);
      setPin("");
      onClose();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Erreur");
      setPin("");
    } finally {
      setLoading(false);
    }
  };
  return (
    <Modal open={!!request} onClose={() => { request?.cancel?.(); setPin(""); setError(null); onClose(); }} title="Autorisation manager" size="sm">
      <p className="mb-3 text-sm text-muted">Opération : <strong>{request ? PERMISSIONS[request.permission].description : ""}</strong>. Un manager doit saisir son PIN.</p>
      <div className="mb-3 flex justify-center gap-3">{[0, 1, 2, 3, 4, 5].map((i) => <span key={i} className={`h-3.5 w-3.5 rounded-full ${i < pin.length ? "bg-lagon-500" : "bg-slate-400/30"}`} />)}</div>
      {error ? <p className="mb-2 rounded-lg bg-red-500/10 px-3 py-2 text-center text-sm text-red-600">{error}</p> : null}
      <NumPad value={pin} onChange={(v) => setPin(v.slice(0, 6))} onSubmit={submit} submitLabel="Autoriser" maxLength={6} disabled={loading} />
    </Modal>
  );
}

const isQueued = (e: unknown) => e instanceof ApiClientError && e.code === "QUEUED";

/**
 * Exécute une opération ; si le serveur exige un PIN manager, délègue à la modale.
 * Sans internet : l'opération est mise en file si l'employé en a le droit, sinon un manager saisit son PIN,
 * vérifié sur la tablette (laissez-passer), et l'opération part en file avec son autorisation.
 * L'appelant reçoit alors l'erreur QUEUED et applique la modification localement.
 */
export function withPin(setRequest: (r: PinRequest) => void, permission: PermissionKey, run: (managerPin?: string) => Promise<unknown>) {
  return run().catch((e) => {
    // Déjà mise en file d'attente par l'appel lui-même : ne jamais la mettre en file une seconde fois
    if (isQueued(e)) throw e;
    if (e instanceof ApiClientError && e.isNetwork && offlineAllowed()) {
      if (localCan(permission)) return withOfflineAuth({ forceQueue: true }, () => run());
      return new Promise((resolve, reject) => setRequest({
        permission,
        run: async (pin) => {
          const pass = await unlockWithPin(pin).catch((err: Error) => { throw new ApiClientError(429, "LOCKED", err.message); });
          if (!pass) throw new ApiClientError(401, "INVALID_PIN", "PIN manager incorrect (hors ligne)");
          if (!(pass.permissions.includes("*") || pass.permissions.includes(permission))) throw new ApiClientError(403, "PIN_NOT_AUTHORIZED", "Ce PIN n'a pas l'autorisation requise");
          // En file avec l'autorisation du manager : la fenêtre se ferme, l'appelant applique la modification localement
          await withOfflineAuth({ forceQueue: true, managerPass: pass.token }, () => run()).then(resolve, (err) => { if (isQueued(err)) reject(err); else throw err; });
        },
        cancel: () => reject(new ApiClientError(0, "PIN_CANCELLED", "Opération annulée")),
      }));
    }
    if (e instanceof ApiClientError && e.isPinRequired) {
      // Mauvais PIN : l'erreur s'affiche dans la fenêtre et on peut réessayer (la promesse reste en attente) ;
      // bon PIN : l'opération aboutit ; fenêtre fermée : l'opération est annulée (les boutons se débloquent).
      return new Promise((resolve, reject) => setRequest({
        permission,
        run: (pin) => run(pin).then(resolve),
        cancel: () => reject(new ApiClientError(0, "PIN_CANCELLED", "Opération annulée")),
      }));
    }
    throw e;
  });
}
