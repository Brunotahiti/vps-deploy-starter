import { prisma, type Tx } from "@/server/db";
import { ApiError } from "@/server/errors";
import { slugify } from "@/lib/slug";
import { audit } from "@/server/audit";
import type { Prisma } from "@/generated/prisma/client";

/** Valeurs par défaut d'un nouvel établissement (TVA, moyens de paiement, poste cuisine). */
export async function createEstablishmentDefaults(establishmentId: string, tx?: Tx) {
  const db = tx ?? prisma;
  // Taux configurables : aucun taux n'est figé dans le code, ce ne sont que des valeurs initiales modifiables.
  await db.taxRate.createMany({
    data: [
      { establishmentId, name: "TVA restauration", rateBps: 1300, isDefault: true },
      { establishmentId, name: "TVA taux normal", rateBps: 1600 },
      { establishmentId, name: "TVA taux réduit", rateBps: 500 },
      { establishmentId, name: "Exonéré", rateBps: 0 },
    ],
  });
  await db.paymentMethodConfig.createMany({
    data: [
      { establishmentId, method: "CASH", label: "Espèces", opensDrawer: true, sortOrder: 1 },
      { establishmentId, method: "CARD", label: "Carte bancaire", sortOrder: 2 },
      { establishmentId, method: "CHECK", label: "Chèque", sortOrder: 3 },
      { establishmentId, method: "TRANSFER", label: "Virement", sortOrder: 4 },
      { establishmentId, method: "MEAL_VOUCHER", label: "Ticket restaurant", sortOrder: 5 },
      { establishmentId, method: "COMPLIMENTARY", label: "Offert", sortOrder: 6 },
      { establishmentId, method: "OTHER", label: "Autre", sortOrder: 7 },
    ],
  });
  await db.kitchenStation.createMany({
    data: [
      { establishmentId, name: "CUISINE", color: "#F97316", sortOrder: 1 },
      { establishmentId, name: "BAR", color: "#3B82F6", sortOrder: 2 },
    ],
  });
}

export async function listEstablishments(organizationId: string) {
  return prisma.establishment.findMany({ where: { organizationId }, orderBy: { name: "asc" } });
}

export async function createEstablishment(organizationId: string, actorId: string, input: { name: string; city?: string | null }) {
  const base = slugify(input.name);
  let slug = base;
  for (let i = 2; await prisma.establishment.findUnique({ where: { organizationId_slug: { organizationId, slug } } }); i++) slug = `${base}-${i}`;
  const est = await prisma.$transaction(async (tx) => {
    const e = await tx.establishment.create({ data: { organizationId, name: input.name, slug, city: input.city ?? null } });
    await createEstablishmentDefaults(e.id, tx);
    return e;
  });
  await audit({ organizationId, establishmentId: est.id, userId: actorId, action: "establishment.create", entityType: "establishment", entityId: est.id, newValue: { name: est.name } });
  return est;
}

export type EstablishmentUpdate = Partial<
  Pick<
    Prisma.EstablishmentUncheckedUpdateInput,
    | "name" | "legalName" | "tahitiNumber" | "addressLine1" | "addressLine2" | "city" | "postalCode" | "island"
    | "phone" | "email" | "currency" | "currencyExponent" | "locale" | "timezone" | "tipsEnabled" | "tipPresetsBps"
    | "openingHours" | "settings" | "onboardingStep" | "onboardingDone" | "businessType"
  >
>;

export async function updateEstablishment(organizationId: string, establishmentId: string, actorId: string, input: EstablishmentUpdate) {
  const before = await prisma.establishment.findFirst({ where: { id: establishmentId, organizationId } });
  if (!before) throw new ApiError(404, "NOT_FOUND", "Établissement introuvable");
  // Les réglages renvoyés au navigateur ont leurs secrets masqués : on ne réécrit jamais le masque à la place du secret
  const data = input.settings !== undefined ? { ...input, settings: restoreSecrets(input.settings, before.settings) as Prisma.InputJsonValue } : input;
  const after = await prisma.establishment.update({ where: { id: establishmentId }, data });
  await audit({
    organizationId, establishmentId, userId: actorId, action: "establishment.update", entityType: "establishment", entityId: establishmentId,
    oldValue: redactFields(pick(before, Object.keys(input))), newValue: redactFields(pick(after, Object.keys(input))),
  });
  return publicEstablishment(after);
}

// ------------------------------------------------------------------ Secrets des réglages
const SECRET_MASK = "••••";
type Json = Record<string, unknown>;

/** Copie des réglages avec les secrets masqués (clé du pont de paiement TPE). */
export function redactSettings(settings: unknown): unknown {
  if (!settings || typeof settings !== "object") return settings;
  const copy = JSON.parse(JSON.stringify(settings)) as Json;
  const terminal = (copy.payments as Json | undefined)?.terminal as Json | undefined;
  if (terminal?.apiKey) terminal.apiKey = SECRET_MASK;
  return copy;
}

/** Établissement présentable au navigateur : réglages sans secrets. */
export function publicEstablishment<T extends { settings?: unknown }>(e: T): T {
  return { ...e, settings: redactSettings(e.settings) };
}

/** Remet le secret enregistré si le navigateur renvoie le masque (ou omet la clé). */
function restoreSecrets(next: unknown, prev: unknown): unknown {
  if (!next || typeof next !== "object") return next;
  const nextTerminal = ((next as Json).payments as Json | undefined)?.terminal as Json | undefined;
  const prevKey = (((prev as Json | null)?.payments as Json | undefined)?.terminal as Json | undefined)?.apiKey;
  if (nextTerminal && (nextTerminal.apiKey === SECRET_MASK || (nextTerminal.apiKey === undefined && prevKey))) nextTerminal.apiKey = prevKey;
  return next;
}

function redactFields(o: Record<string, unknown>) {
  return "settings" in o ? { ...o, settings: redactSettings(o.settings) } : o;
}

function pick<T extends object>(obj: T, keys: string[]) {
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = (obj as Record<string, unknown>)[k];
  return out;
}
