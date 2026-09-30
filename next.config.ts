import type { NextConfig } from "next";

/** Identifiant de build : commit (BUILD_ID/GIT_SHA fournis par le déploiement) ou horodatage. */
const buildId = (process.env.BUILD_ID || process.env.GIT_SHA || "").slice(0, 12) || new Date().toISOString().replace(/\D/g, "").slice(0, 12);

const nextConfig: NextConfig = {
  output: "standalone",
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
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
        ],
      },
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

export default nextConfig;
