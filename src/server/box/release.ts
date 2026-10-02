import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { BUILD_ID } from "@/lib/build";
import { ApiError } from "@/server/errors";

/**
 * Version du boîtier = l'application qui tourne sur le cloud, telle quelle (dossier de l'image : server.js,
 * fichiers de l'application, migrations, passerelle du boîtier). Le boîtier la télécharge avec sa clé : même
 * version des deux côtés, sans registre d'images ni compte supplémentaire. Archive faite une fois par version.
 */
export const releaseId = () => BUILD_ID;
const releaseDir = () => process.env.BOX_RELEASE_DIR || process.cwd();
let building: Promise<string> | null = null;

export function releaseAvailable(dir = releaseDir()) {
  return ["server.js", "box/box.mjs", "box/gateway.mjs", "prisma/migrations"].every((f) => fs.existsSync(path.join(dir, f)));
}

/** Archive .tar.gz de la version (chemin du fichier, gardé dans le dossier temporaire). */
export async function releaseArchive(dir = releaseDir()): Promise<string> {
  if (!releaseAvailable(dir)) throw new ApiError(503, "NO_RELEASE", "Version du boîtier indisponible sur ce serveur");
  const file = path.join(os.tmpdir(), `manaresto-box-${releaseId().replace(/[^\w.-]/g, "")}.tgz`);
  if (fs.existsSync(file)) return file;
  building ??= new Promise<string>((resolve, reject) => {
    const tmp = `${file}.${process.pid}.tmp`;
    // Jamais de fichier de configuration (.env) ni de cache dans la version envoyée aux boîtiers
    const tar = spawn("tar", ["-czf", tmp, "--exclude=./.env*", "--exclude=./.next/cache", "-C", dir, "."], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    tar.stderr.on("data", (d) => { err += d; });
    tar.on("error", reject);
    tar.on("close", (code) => {
      if (code !== 0) { fs.rmSync(tmp, { force: true }); return reject(new Error(`tar ${code} ${err.slice(0, 300)}`)); }
      fs.renameSync(tmp, file);
      resolve(file);
    });
  }).finally(() => { building = null; });
  return building;
}
