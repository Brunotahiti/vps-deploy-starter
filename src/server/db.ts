import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL manquante");
  // Connexions gardées ouvertes 5 min (au lieu de 10 s) : moins de reconnexions, donc moins de recherches du nom
  // « db » sur le réseau Docker, qui peuvent échouer quand le serveur est chargé (getaddrinfo EAI_AGAIN db)
  const adapter = new PrismaPg({ connectionString, max: 10, idleTimeoutMillis: 300_000, keepAlive: true, connectionTimeoutMillis: 10_000 });
  return new PrismaClient({
    adapter,
    log: process.env.PRISMA_LOG === "1" ? ["query", "warn", "error"] : ["warn", "error"],
  });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
