import * as Sentry from "@sentry/nextjs";

/** Chargement de Sentry selon le runtime, et capture des erreurs de rendu côté serveur. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("../sentry.server.config");
  if (process.env.NEXT_RUNTIME === "edge") await import("../sentry.edge.config");
}

export const onRequestError = Sentry.captureRequestError;
