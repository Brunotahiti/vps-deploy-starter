import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

/** Identifiant de build : commit (BUILD_ID/GIT_SHA fournis par le déploiement) ou horodatage. */
const buildId = (process.env.BUILD_ID || process.env.GIT_SHA || "").slice(0, 12) || new Date().toISOString().replace(/\D/g, "").slice(0, 12);

const nextConfig: NextConfig = {
  output: "standalone",
  env: { NEXT_PUBLIC_BUILD_ID: buildId, NEXT_PUBLIC_SENTRY_DSN: process.env.SENTRY_DSN ?? "", NEXT_PUBLIC_SENTRY_ENVIRONMENT: process.env.SENTRY_ENVIRONMENT ?? "production" },
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["pdfkit", "pg"],
  // Polices AFM de pdfkit (tickets PDF) à embarquer dans le build standalone (Docker)
  outputFileTracingIncludes: { "/api/orders/[id]/receipt": ["./node_modules/pdfkit/js/data/**", "./node_modules/.pnpm/pdfkit@*/node_modules/pdfkit/js/data/**"] },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // Défense en profondeur : ni plugins, ni balise <base> détournée, ni formulaire envoyé ailleurs, ni affichage dans un cadre
          { key: "Content-Security-Policy", value: "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" },
        ],
      },
      // Photos de démonstration, icônes et polices : gardées 30 jours par le navigateur et par Cloudflare
      ...["/demo/:path*", "/email/:path*", "/icons/:path*", "/brand/:path*", "/fonts/:path*"].map((source) => ({
        source,
        headers: [{ key: "Cache-Control", value: "public, max-age=2592000, stale-while-revalidate=86400" }],
      })),
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

/**
 * Sentry : suivi des erreurs (client, serveur, edge). Sans SENTRY_DSN, rien n'est envoyé.
 * Les source maps ne sont téléversées que si SENTRY_AUTH_TOKEN est fourni au build (facultatif).
 */
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG || "manaprocess-rd",
  project: process.env.SENTRY_PROJECT || "manaresto",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  telemetry: false,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  release: { create: !!process.env.SENTRY_AUTH_TOKEN, name: buildId ? `manaresto@${buildId}` : undefined },
  tunnelRoute: "/monitoring", // contourne les bloqueurs de publicité
  widenClientFileUpload: true,
});
