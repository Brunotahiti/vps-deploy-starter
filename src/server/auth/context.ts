import { cache } from "react";
import { prisma } from "@/server/db";
import { ApiError } from "@/server/errors";
import { ALL_PERMISSIONS, hasPermission, type PermissionKey } from "@/lib/permissions";
import { lockedPermissions, OPTIONS, type OptionKey } from "@/lib/options";
import { headers } from "next/headers";
import { findSessionByToken, getSessionToken, getTerminalFromCookie } from "./session";
import { findOfflinePass } from "@/server/services/offline-pass";
import type { Establishment, Terminal, User } from "@/generated/prisma/client";

export type AuthContext = {
  sessionId: string;
  user: User;
  organizationId: string;
  establishment: Establishment | null;
  establishments: { id: string; name: string; slug: string; roleKey: string }[];
  roleKey: string | null;
  permissions: Set<string>;
  terminal: Terminal | null;
  impersonatorId: string | null;
  /** Options payantes débloquées par l'entreprise (voir src/lib/options.ts) */
  options: string[];
};

/** En-tête des opérations faites hors ligne : laissez-passer de l'employé qui les a saisies (voir offline-pass.ts). */
export const OFFLINE_PASS_HEADER = "x-offline-pass";

async function loadContext(): Promise<AuthContext | null> {
  // Opération saisie hors ligne puis rejouée : attribuée à l'employé qui l'a faite, même si la session de la tablette
  // a expiré ou appartient à un autre. Laissez-passer invalide (révoqué, expiré) : la session de la tablette prend le relais.
  const passToken = (await headers()).get(OFFLINE_PASS_HEADER);
  if (passToken) {
    const terminal = await getTerminalFromCookie();
    const pass = terminal ? await findOfflinePass(passToken, terminal.id) : null;
    if (pass) {
      const { organization: _org, ...user } = pass.user;
      void _org;
      return buildContext({ id: pass.id, userId: pass.userId, establishmentId: pass.establishmentId, impersonatorId: null, user });
    }
  }
  const token = await getSessionToken();
  if (!token) return null;
  const session = await findSessionByToken(token);
  if (!session) return null;
  return buildContext(session);
}

async function buildContext(session: { id: string; userId: string; establishmentId: string | null; impersonatorId: string | null; user: User }): Promise<AuthContext> {
  const memberships = await prisma.userEstablishment.findMany({
    where: { userId: session.userId, establishment: { isActive: true } },
    include: { establishment: true, role: { include: { permissions: true } } },
    orderBy: { establishment: { name: "asc" } },
  });

  const user = session.user;
  let current = memberships.find((m) => m.establishmentId === session.establishmentId) ?? null;
  if (!current && memberships.length > 0 && !user.isOwner) current = memberships[0];
  // Le propriétaire a accès à tous les établissements de l'entreprise même sans membership explicite
  let establishment: Establishment | null = current?.establishment ?? null;
  if (!establishment && user.isOwner) {
    establishment = await prisma.establishment.findFirst({
      where: {
        organizationId: user.organizationId,
        isActive: true,
        ...(session.establishmentId ? { id: session.establishmentId } : {}),
      },
      orderBy: { createdAt: "asc" },
    });
  }

  const permissions = new Set<string>();
  let roleKey: string | null = current?.role.key ?? null;
  if (user.isOwner) {
    permissions.add("*");
    roleKey = "owner";
  } else if (current) {
    for (const p of current.role.permissions) permissions.add(p.permissionKey);
  }
  // Options non débloquées : leurs droits sont retirés à tous, propriétaire compris
  const options = (await prisma.organization.findUnique({ where: { id: user.organizationId }, select: { options: true } }))?.options ?? [];
  const locked = lockedPermissions(options);
  if (locked.size) {
    if (permissions.delete("*")) for (const p of ALL_PERMISSIONS) permissions.add(p);
    for (const p of locked) permissions.delete(p);
  }

  const terminal = await getTerminalFromCookie();
  const ownerEstablishments = user.isOwner
    ? await prisma.establishment.findMany({
        where: { organizationId: user.organizationId, isActive: true },
        select: { id: true, name: true, slug: true },
        orderBy: { name: "asc" },
      })
    : [];

  const establishments = user.isOwner
    ? ownerEstablishments.map((e) => ({ ...e, roleKey: "owner" }))
    : memberships.map((m) => ({ id: m.establishmentId, name: m.establishment.name, slug: m.establishment.slug, roleKey: m.role.key }));

  return {
    sessionId: session.id,
    user,
    organizationId: user.organizationId,
    establishment,
    establishments,
    roleKey,
    permissions,
    terminal: terminal && establishment && terminal.establishmentId === establishment.id ? terminal : null,
    impersonatorId: session.impersonatorId,
    options,
  };
}

/** Contexte d'authentification, mémoïsé par requête (React cache). */
export const getAuthContext = cache(loadContext);

export async function requireAuth(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) throw new ApiError(401, "UNAUTHENTICATED", "Authentification requise");
  return ctx;
}

export async function requireEstablishment(): Promise<AuthContext & { establishment: Establishment }> {
  const ctx = await requireAuth();
  if (!ctx.establishment) throw new ApiError(403, "NO_ESTABLISHMENT", "Aucun établissement associé à ce compte");
  return ctx as AuthContext & { establishment: Establishment };
}

export async function requirePermission(...keys: PermissionKey[]) {
  const ctx = await requireEstablishment();
  for (const key of keys) {
    if (!hasPermission(ctx.permissions, key)) {
      throw new ApiError(403, "FORBIDDEN", `Permission requise : ${key}`, { permission: key });
    }
  }
  return ctx;
}

export function can(ctx: Pick<AuthContext, "permissions">, key: PermissionKey) {
  return hasPermission(ctx.permissions, key);
}

/** Fonction d'une option payante : refusée tant qu'elle n'est pas débloquée (Gestion → Options). */
export function requireOption(ctx: Pick<AuthContext, "options">, key: OptionKey) {
  if (!ctx.options.includes(key)) throw new ApiError(403, "OPTION_REQUIRED", `Option « ${OPTIONS[key].label} » à débloquer dans Gestion → Options`, { option: key });
}
