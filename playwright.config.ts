import { defineConfig } from "@playwright/test";

// Les requêtes du service worker passent par context.route : une coupure simulée les coupe aussi (tests hors ligne)
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS ??= "1";

/**
 * Tests E2E ManaResto. Cible un serveur déjà démarré (E2E_BASE_URL, défaut http://localhost:3100)
 * avec la base de démonstration (pnpm db:seed).
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
    browserName: "chromium",
    viewport: { width: 1194, height: 834 },
    hasTouch: true,
    launchOptions: { args: process.env.PLAYWRIGHT_NO_SANDBOX ? ["--no-sandbox"] : [] },
    trace: "retain-on-failure",
  },
});
