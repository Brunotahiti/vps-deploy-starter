/** Client HTTP côté navigateur : enveloppe { data } / { error }, erreurs typées, support hors ligne. */
import { outbox } from "./offline/outbox";

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
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: "same-origin", signal: opts.signal });
  } catch (e) {
    if (opts.queueIfOffline && method !== "GET") {
      await outbox.enqueue({ method, url, body, idempotencyKey: opts.idempotencyKey ?? crypto.randomUUID() });
      throw new ApiClientError(0, "QUEUED", "Hors ligne : opération mise en file d'attente");
    }
    throw new ApiClientError(0, "NETWORK", "Connexion indisponible", e);
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const err = json?.error ?? { code: "HTTP_" + res.status, message: res.statusText };
    throw new ApiClientError(res.status, err.code, err.message, err.details);
  }
  // Enveloppe { data } : une donnée nulle (ex. aucune caisse ouverte) doit rester null, pas devenir l'enveloppe elle-même
  if (json && typeof json === "object" && "data" in json) return json.data as T;
  return json as T;
}

export const api = {
  get: <T>(url: string, opts?: Options) => request<T>("GET", url, undefined, opts),
  post: <T>(url: string, body?: unknown, opts?: Options) => request<T>("POST", url, body ?? {}, opts),
  patch: <T>(url: string, body?: unknown, opts?: Options) => request<T>("PATCH", url, body ?? {}, opts),
  put: <T>(url: string, body?: unknown, opts?: Options) => request<T>("PUT", url, body ?? {}, opts),
  delete: <T>(url: string, body?: unknown, opts?: Options) => request<T>("DELETE", url, body, opts),
};
