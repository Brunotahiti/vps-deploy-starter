import * as Sentry from "@sentry/nextjs";

/** Sentry côté serveur (Node) : activé seulement si SENTRY_DSN est renseignée. */
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || "production",
    release: process.env.NEXT_PUBLIC_BUILD_ID ? `manaresto@${process.env.NEXT_PUBLIC_BUILD_ID}` : undefined,
    tracesSampleRate: 0.1,
  });
}
