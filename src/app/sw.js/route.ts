import { SW_SOURCE } from "@/pwa/sw-source";
import { BUILD_ID } from "@/lib/build";

/**
 * Service worker versionné : son contenu change à chaque build, ce qui déclenche la détection
 * d'une nouvelle version côté navigateur (bouton « Mettre à jour »).
 */
export function GET() {
  return new Response(SW_SOURCE.replace("__BUILD__", BUILD_ID), {
    headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-cache, no-store, must-revalidate", "Service-Worker-Allowed": "/" },
  });
}
