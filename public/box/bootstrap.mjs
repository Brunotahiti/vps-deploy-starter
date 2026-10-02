/**
 * Démarrage du boîtier de secours ManaResto (conteneur node:22-alpine, dossier /data).
 * Première fois : télécharge la version de l'application depuis ManaResto (clé du boîtier) ; ensuite : lance le
 * programme du boîtier de la version installée (/data/current/box/box.mjs), qui se met à jour lui-même.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";

const DATA = process.env.DATA_DIR || "/data";
const CURRENT = path.join(DATA, "current");
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function firstInstall() {
  const res = await fetch(new URL("/api/box/release", process.env.CLOUD_URL), { headers: { authorization: `Bearer ${process.env.BOX_TOKEN}` } });
  if (!res.ok || !res.body) throw new Error(`ManaResto a répondu ${res.status}${res.status === 401 ? " (clé du boîtier refusée)" : ""}`);
  const id = (res.headers.get("x-box-release") || "initial").replace(/[^\w.-]/g, "");
  const dir = path.join(DATA, "releases", id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const archive = `${dir}.tgz`;
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(archive));
  await new Promise((resolve, reject) => {
    const tar = spawn("tar", ["-xzf", archive, "-C", dir], { stdio: "inherit" });
    tar.on("error", reject);
    tar.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`décompression : ${code}`))));
  });
  fs.rmSync(archive, { force: true });
  fs.rmSync(CURRENT, { force: true });
  fs.symlinkSync(path.join("releases", id), CURRENT);
  log(`[boîtier] version ${id} installée`);
}

for (;;) {
  if (fs.existsSync(path.join(CURRENT, "box/box.mjs"))) break;
  try {
    log("[boîtier] téléchargement de l'application ManaResto…");
    await firstInstall();
  } catch (err) {
    log(`[boîtier] installation impossible (${err.message}) : nouvel essai dans 30 s`);
    await new Promise((r) => setTimeout(r, 30_000));
  }
}

const { runBox } = await import(pathToFileURL(path.join(fs.realpathSync(CURRENT), "box/box.mjs")).href);
await runBox();
