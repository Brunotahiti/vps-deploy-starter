import * as Sentry from "@sentry/nextjs";

/** Chargement de Sentry selon le runtime, capture des erreurs de rendu côté serveur, relances e-mail planifiées. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
    // Relances automatiques (rappel de fin d'essai, essai expiré) : production uniquement, jamais sur un boîtier local
    if (process.env.NODE_ENV === "production" && process.env.BOX_MODE !== "1") {
      const { startLifecycleScheduler } = await import("@/server/services/platform-emails");
      startLifecycleScheduler();
    }
  }
  if (process.env.NEXT_RUNTIME === "edge") await import("../sentry.edge.config");
}

export const onRequestError = Sentry.captureRequestError;
