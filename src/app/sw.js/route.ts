import { readdir } from "node:fs/promises";
import path from "node:path";
import { SW_SOURCE } from "@/pwa/sw-source";
import { BUILD_ID } from "@/lib/build";

/** Fichiers d'un dossier, récursivement (chemins relatifs, séparateur « / »). */
async function walk(dir: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const e of entries) {
    if (e.isDirectory()) out.push(...(await walk(path.join(dir, e.name), `${prefix}${e.name}/`)));
    else out.push(`${prefix}${e.name}`);
  }
  return out;
}

let assets: Promise<string[]> | null = null;
/** Tous les fichiers de l'application (JS, CSS de Next) et les polices, icônes et visuels de connexion : la liste ne change qu'au build. */
function listAssets() {
  assets ??= (async () => {
    const root = process.cwd();
    const next = (await walk(path.join(root, ".next/static"))).filter((f) => /\.(js|css|woff2?)$/.test(f)).map((f) => `/_next/static/${f}`);
    const pub = (await Promise.all(["fonts", "icons", "brand"].map(async (d) => (await walk(path.join(root, "public", d))).map((f) => `/${d}/${f}`)))).flat();
    return [...next, ...pub];
  })();
  return assets;
}

/**
 * Service worker versionné : son contenu change à chaque build, ce qui déclenche la détection
 * d'une nouvelle version côté navigateur (bouton « Mettre à jour »).
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const list = process.env.NODE_ENV === "production" ? await listAssets() : [];
  return new Response(SW_SOURCE.replace("__BUILD__", BUILD_ID).replace("__ASSETS__", JSON.stringify(list)), {
    headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-cache, no-store, must-revalidate", "Service-Worker-Allowed": "/" },
  });
}
