import * as Sentry from "@sentry/nextjs";

/** Sentry pour le runtime edge (middleware) : activé seulement si SENTRY_DSN est renseignée. */
if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.SENTRY_ENVIRONMENT || "production", tracesSampleRate: 0.1 });
}
