/** Client HTTP côté navigateur : enveloppe { data } / { error }, erreurs typées, support hors ligne. */
import { outbox } from "./offline/outbox";
import { forceQueue, liveHeaders, offlineAllowed, OFFLINE_OPTION_MESSAGE, queuedHeaders } from "./offline/auth-state";

export class ApiClientError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
    this.name = "ApiClientError";
  }
  get isPinRequired() { return this.code === "PIN_REQUIRED"; }
  get isNetwork() { return this.status === 0; }
}

type Options = { idempotencyKey?: string; queueIfOffline?: boolean; signal?: AbortSignal };

async function request<T>(method: string, url: string, body?: unknown, opts: Options = {}): Promise<T> {
  // Lu tout de suite (avant tout await) : une autorisation hors ligne vaut pour les requêtes lancées dans withOfflineAuth
  const headers: Record<string, string> = { Accept: "application/json", ...liveHeaders() };
  const queueHeaders = queuedHeaders();
  // Sans l'option Continuité de service, rien n'est mis en file : l'opération échoue avec un message clair
  const queueIfOffline = offlineAllowed() && (opts.queueIfOffline || forceQueue());
  if (body !== undefined) headers["Content-Type"] = "application/json";
  // Clé d'idempotence dès le PREMIER envoi : si la réponse se perd, le rejeu ne s'applique pas deux fois
  const idempotencyKey = opts.idempotencyKey ?? (queueIfOffline && method !== "GET" ? crypto.randomUUID() : undefined);
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  // Délai maximal (Wi-Fi saturé) : au-delà, l'opération part en file d'attente au lieu de tourner indéfiniment
  const timeout = typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(method === "GET" ? 15_000 : 12_000) : undefined;
  const signal = opts.signal && timeout && "any" in AbortSignal ? AbortSignal.any([opts.signal, timeout]) : (opts.signal ?? timeout);
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: "same-origin", signal });
  } catch (e) {
    if (opts.signal?.aborted) throw e; // annulation voulue par l'appelant : ni file d'attente ni erreur réseau
    if (queueIfOffline && method !== "GET") {
      await outbox.enqueue({ method, url, body, idempotencyKey: idempotencyKey ?? crypto.randomUUID(), ...(Object.keys(queueHeaders).length ? { headers: queueHeaders } : {}) });
      throw new ApiClientError(0, "QUEUED", "Hors ligne : opération mise en file d'attente");
    }
    throw new ApiClientError(0, "NETWORK", offlineAllowed() ? "Connexion indisponible" : OFFLINE_OPTION_MESSAGE, e);
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const err = json?.error ?? { code: "HTTP_" + res.status, message: "" };
    throw new ApiClientError(res.status, err.code, err.message || httpMessage(res.status), err.details);
  }
  // Enveloppe { data } : une donnée nulle (ex. aucune caisse ouverte) doit rester null, pas devenir l'enveloppe elle-même
  if (json && typeof json === "object" && "data" in json) return json.data as T;
  return json as T;
}

/**
 * Réponse sans message exploitable (serveur en cours de redémarrage, proxy) : en HTTPS (HTTP/2) le texte de statut
 * est toujours vide, il faut donc un message lisible, sans quoi la notification d'erreur s'afficherait vide.
 */
export function httpMessage(status: number): string {
  if (status === 502 || status === 503 || status === 504) return "Le serveur redémarre (mise à jour en cours) : réessayez dans quelques secondes";
  if (status === 404) return "Service momentanément indisponible : réessayez dans quelques secondes";
  if (status === 413) return "Envoi trop volumineux";
  if (status === 429) return "Trop de tentatives : patientez un instant puis réessayez";
  if (status === 401 || status === 403) return "Accès refusé : reconnectez-vous";
  return `Erreur inattendue (${status}) : réessayez`;
}

export const api = {
  get: <T>(url: string, opts?: Options) => request<T>("GET", url, undefined, opts),
  post: <T>(url: string, body?: unknown, opts?: Options) => request<T>("POST", url, body ?? {}, opts),
  patch: <T>(url: string, body?: unknown, opts?: Options) => request<T>("PATCH", url, body ?? {}, opts),
  put: <T>(url: string, body?: unknown, opts?: Options) => request<T>("PUT", url, body ?? {}, opts),
  delete: <T>(url: string, body?: unknown, opts?: Options) => request<T>("DELETE", url, body, opts),
};
