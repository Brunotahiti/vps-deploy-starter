import "dotenv/config";
import { execSync } from "node:child_process";

/** Prépare la base de test (migrations) avant l'exécution des tests d'intégration. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? (process.env.DATABASE_URL ?? "").replace(/\/manaresto(\?|$)/, "/manaresto_test$1");
  if (!url) return;
  process.env.DATABASE_URL = url;
  execSync("npx prisma migrate deploy", { stdio: "ignore", env: { ...process.env, DATABASE_URL: url } });
}
