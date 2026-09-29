import "dotenv/config";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const url = process.env.TEST_DATABASE_URL ?? (process.env.DATABASE_URL ?? "").replace(/\/manaresto(\?|$)/, "/manaresto_test$1");
process.env.DATABASE_URL = url;

export const testDb = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

export async function resetDb() {
  await testDb.$executeRawUnsafe(`TRUNCATE TABLE organizations, permissions RESTART IDENTITY CASCADE`);
}
