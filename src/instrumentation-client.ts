import * as Sentry from "@sentry/nextjs";

/** Sentry côté navigateur : activé seulement si NEXT_PUBLIC_SENTRY_DSN est renseignée au build. */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || "production",
    release: process.env.NEXT_PUBLIC_BUILD_ID ? `manaresto@${process.env.NEXT_PUBLIC_BUILD_ID}` : undefined,
    tracesSampleRate: 0.1,
    // Erreurs réseau attendues hors ligne (la caisse fonctionne sans Internet) : inutile de les remonter
    ignoreErrors: [/Failed to fetch/, /NetworkError/, /Load failed/, /offline/i, /AbortError/],
    beforeSend(event) {
      if (typeof navigator !== "undefined" && !navigator.onLine) return null;
      return event;
    },
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
