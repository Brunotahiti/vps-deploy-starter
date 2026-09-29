import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL manquante");
  const adapter = new PrismaPg({ connectionString, max: 10 });
  return new PrismaClient({
    adapter,
    log: process.env.PRISMA_LOG === "1" ? ["query", "warn", "error"] : ["warn", "error"],
  });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
