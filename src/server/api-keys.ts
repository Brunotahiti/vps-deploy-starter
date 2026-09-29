import { createHash, randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { ApiError } from "@/server/errors";
import { audit } from "@/server/audit";
import type { Actor } from "@/server/services/orders";

/**
 * Phase 7 — API publique : clés `mr_live_…` (affichées une seule fois, stockées hachées),
 * portées (scopes) par domaine, en-tête `Authorization: Bearer <clé>`.
 */
export const API_SCOPES = { "orders:read": "Lire les commandes", "orders:write": "Créer des commandes (canal API)", "catalog:read": "Lire le catalogue", "reports:read": "Lire les rapports", "stock:read": "Lire les stocks", "customers:read": "Lire les clients" } as const;
export type ApiScope = keyof typeof API_SCOPES;
const hash = (key: string) => createHash("sha256").update(key).digest("hex");

export async function listApiKeys(establishmentId: string) {
  return prisma.apiKey.findMany({ where: { establishmentId }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, prefix: true, scopes: true, lastUsedAt: true, isActive: true, createdAt: true } });
}

export async function createApiKey(actor: Actor, input: { name: string; scopes: string[] }) {
  const scopes = input.scopes.filter((s) => s in API_SCOPES);
  if (scopes.length === 0) throw new ApiError(400, "NO_SCOPES", "Choisissez au moins une portée");
  const key = `mr_live_${randomBytes(24).toString("base64url")}`;
  const row = await prisma.apiKey.create({ data: { organizationId: actor.organizationId, establishmentId: actor.establishmentId, name: input.name, prefix: key.slice(0, 12), keyHash: hash(key), scopes, createdById: actor.userId } });
  await audit({ ...actor, action: "api_key.create", entityType: "api_key", entityId: row.id, newValue: { name: row.name, scopes } });
  return { id: row.id, name: row.name, prefix: row.prefix, scopes: row.scopes, key }; // clé en clair une seule fois
}

export async function revokeApiKey(actor: Actor, id: string) {
  const existing = await prisma.apiKey.findFirst({ where: { id, establishmentId: actor.establishmentId } });
  if (!existing) throw new ApiError(404, "NOT_FOUND", "Clé introuvable");
  await prisma.apiKey.update({ where: { id }, data: { isActive: false } });
  await audit({ ...actor, action: "api_key.revoke", entityType: "api_key", entityId: id, oldValue: { name: existing.name } });
}

export type ApiContext = { keyId: string; organizationId: string; establishmentId: string; scopes: string[]; establishment: { id: string; name: string; timezone: string; currency: string } };

/** Authentifie une requête de l'API publique et vérifie la portée demandée. */
export async function requireApiKey(req: NextRequest, scope: ApiScope): Promise<ApiContext> {
  const auth = req.headers.get("authorization") ?? "";
  const key = auth.startsWith("Bearer ") ? auth.slice(7).trim() : (req.nextUrl.searchParams.get("api_key") ?? "");
  if (!key.startsWith("mr_live_")) throw new ApiError(401, "UNAUTHORIZED", "Clé API manquante (en-tête Authorization: Bearer mr_live_…)");
  const row = await prisma.apiKey.findUnique({ where: { keyHash: hash(key) }, include: { establishment: { select: { id: true, name: true, timezone: true, currency: true, isActive: true } } } });
  if (!row || !row.isActive || !row.establishment.isActive) throw new ApiError(401, "UNAUTHORIZED", "Clé API invalide ou révoquée");
  if (!row.scopes.includes(scope)) throw new ApiError(403, "FORBIDDEN", `Portée requise : ${scope}`);
  prisma.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return { keyId: row.id, organizationId: row.organizationId, establishmentId: row.establishmentId, scopes: row.scopes, establishment: row.establishment };
}
