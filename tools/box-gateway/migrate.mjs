/**
 * Base du boîtier : applique les migrations de la version installée (mêmes fichiers que le cloud, livrés avec elle).
 * Compatible avec la table `_prisma_migrations` de Prisma : la copie du restaurant vérifie la dernière migration
 * des deux côtés avant tout import.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

const TABLE = `CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id" VARCHAR(36) PRIMARY KEY NOT NULL,
  "checksum" VARCHAR(64) NOT NULL,
  "finished_at" TIMESTAMPTZ,
  "migration_name" VARCHAR(255) NOT NULL,
  "logs" TEXT,
  "rolled_back_at" TIMESTAMPTZ,
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "applied_steps_count" INTEGER NOT NULL DEFAULT 0
)`;

/** Migrations disponibles, dans l'ordre (un dossier par migration, contenant migration.sql). */
export function listMigrations(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, "migration.sql")))
    .map((d) => d.name)
    .sort();
}

/** Applique les migrations manquantes, chacune dans sa transaction. Renvoie les noms appliqués. */
export async function applyMigrations({ databaseUrl, dir, log = () => {} }) {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const applied = [];
  try {
    await client.query(TABLE);
    const done = new Set((await client.query(`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`)).rows.map((r) => r.migration_name));
    for (const name of listMigrations(dir)) {
      if (done.has(name)) continue;
      const sql = fs.readFileSync(path.join(dir, name, "migration.sql"), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query(`INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, applied_steps_count) VALUES ($1, $2, now(), $3, 1)`, [randomUUID(), checksum, name]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw new Error(`Migration ${name} impossible : ${err.message}`);
      }
      log(`[boîtier] migration appliquée : ${name}`);
      applied.push(name);
    }
  } finally {
    await client.end();
  }
  return applied;
}
