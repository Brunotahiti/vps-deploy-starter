import { prisma } from "@/server/db";
import { ApiError } from "@/server/errors";
import { audit } from "@/server/audit";
import { isEmailConfigured, platformMail, sendMail } from "@/server/email/mailer";
import { OPTIONS, OPTION_KEYS, SERVICES, SERVICE_KEYS, isOptionKey, isServiceKey, serviceOf, serviceRef, type OptionKey } from "@/lib/options";
import { OFFER } from "@/lib/plan";
import { DEMO_ORG_SLUG } from "@/lib/platform";
import { consoleUrl, teamRecipients } from "./platform-emails";
import type { Actor } from "./orders";

/*
 * Options payantes : le restaurateur voit ce qui est actif et demande à débloquer le reste depuis Gestion → Options ;
 * l'équipe ManaResto active l'option depuis la console (facturation hors ligne en attendant le paiement en ligne).
 */

const appUrl = () => process.env.PUBLIC_URL?.replace(/\/$/, "") || "https://app.manaresto.com";
const fmt = (n: number) => `${n.toLocaleString("fr-FR").replace(/ /g, " ")} F CFP`;

export async function optionPrices(): Promise<Record<string, number | null>> {
  const rows = await prisma.optionPrice.findMany();
  // Options : prix mensuel ; services ponctuels (« service:… ») : prix unique
  return Object.fromEntries([...OPTION_KEYS, ...SERVICE_KEYS.map(serviceRef)].map((k) => [k, rows.find((r) => r.option === k)?.monthly ?? null]));
}

/** Services ponctuels pour l'écran Options : prix unique (ou « sur demande »), demande en cours, dernière réalisation. */
export async function listServices(organizationId: string) {
  const [prices, requests] = await Promise.all([
    optionPrices(),
    prisma.optionRequest.findMany({ where: { organizationId, option: { startsWith: "service:" } }, orderBy: { createdAt: "desc" }, select: { option: true, status: true, createdAt: true, handledAt: true } }),
  ]);
  return SERVICE_KEYS.map((key) => ({
    key, ...SERVICES[key],
    price: prices[serviceRef(key)],
    requestedAt: requests.find((r) => r.option === serviceRef(key) && r.status === "PENDING")?.createdAt ?? null,
    doneAt: requests.find((r) => r.option === serviceRef(key) && r.status === "DONE")?.handledAt ?? null,
  }));
}

/** Demande d'un service ponctuel : notée (une seule en attente par service) et signalée à l'équipe ManaResto. */
export async function requestService(actor: Actor, key: string, note?: string | null) {
  if (!isServiceKey(key)) throw new ApiError(400, "BAD_SERVICE", "Service inconnu");
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: actor.organizationId }, select: { name: true, slug: true } });
  if (org.slug === DEMO_ORG_SLUG) throw new ApiError(403, "DEMO_READ_ONLY", "Sur le restaurant exemple, les services ne se demandent pas : créez votre compte");
  const ref = serviceRef(key);
  const existing = await prisma.optionRequest.findFirst({ where: { organizationId: actor.organizationId, option: ref, status: "PENDING" } });
  if (existing) return existing;
  const req = await prisma.optionRequest.create({ data: { organizationId: actor.organizationId, option: ref, requestedById: actor.userId } });
  await audit({ ...actor, action: "service.request", entityType: "organization", entityId: actor.organizationId, newValue: { service: key, note: note?.trim() || null } });
  if (isEmailConfigured()) {
    const who = await prisma.user.findUnique({ where: { id: actor.userId }, select: { firstName: true, lastName: true, email: true } });
    await sendMail(platformMail({
      to: teamRecipients(), replyTo: who?.email ?? OFFER.contactEmail, subject: `Demande de service : ${SERVICES[key].label} · ${org.name}`,
      kicker: "ManaResto · console", title: `${org.name} demande « ${SERVICES[key].label} »`,
      paragraphs: [`Demande faite par ${who ? `${who.firstName} ${who.lastName} (${who.email})` : "le restaurant"}.`, ...(note?.trim() ? [`Précisions : ${note.trim()}`] : []), "Recontactez le restaurant pour convenir des détails, puis marquez la demande comme traitée dans la console."],
      cta: { label: "Ouvrir la console", url: consoleUrl() }, footer: "Message automatique de ManaResto.",
    })).catch(() => {});
  }
  return req;
}

/** Console : demande de service traitée (réalisée) ou refusée. Les options, elles, se closent en les activant. */
export async function handleServiceRequest(id: string, status: "DONE" | "DECLINED", admin: { id: string; email: string }) {
  const r = await prisma.optionRequest.findUnique({ where: { id } });
  if (!r || !serviceOf(r.option)) throw new ApiError(404, "NOT_FOUND", "Demande de service introuvable");
  const upd = await prisma.optionRequest.update({ where: { id }, data: { status, handledAt: new Date() } });
  await audit({ organizationId: r.organizationId, action: "platform.service", entityType: "organization", entityId: r.organizationId, newValue: { service: r.option, status }, reason: `Console ManaResto (${admin.email})` });
  return upd;
}

/** Les quatre options pour l'écran Options : actives, demandées ou à débloquer, avec leur prix (ou « sur demande »). */
export async function listOptions(organizationId: string) {
  const [org, prices, pending] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { options: true } }),
    optionPrices(),
    prisma.optionRequest.findMany({ where: { organizationId, status: "PENDING" }, select: { option: true, createdAt: true } }),
  ]);
  return OPTION_KEYS.map((key) => ({
    key, ...OPTIONS[key],
    enabled: org.options.includes(key),
    monthly: prices[key],
    requestedAt: pending.find((p) => p.option === key)?.createdAt ?? null,
  }));
}

/** Demande de déblocage : notée (une seule en attente par option) et signalée à l'équipe ManaResto. */
export async function requestOption(actor: Actor, key: string) {
  return (await requestOptions(actor, [key]))[0];
}

/**
 * Demande d'une ou plusieurs options en une fois (sélection de la page Options) : une demande en attente par option,
 * un seul e-mail à l'équipe ManaResto qui les liste toutes.
 */
export async function requestOptions(actor: Actor, keys: string[]) {
  const wanted = [...new Set(keys)];
  if (!wanted.length) throw new ApiError(400, "BAD_OPTION", "Choisissez au moins une option");
  for (const k of wanted) if (!isOptionKey(k)) throw new ApiError(400, "BAD_OPTION", "Option inconnue");
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: actor.organizationId }, select: { name: true, slug: true, options: true } });
  if (org.slug === DEMO_ORG_SLUG) throw new ApiError(403, "DEMO_READ_ONLY", "Sur le restaurant exemple, toutes les options sont déjà ouvertes : créez votre compte pour les demander");
  const active = wanted.filter((k) => org.options.includes(k));
  if (active.length === wanted.length) throw new ApiError(409, "ALREADY_ENABLED", active.length > 1 ? "Ces options sont déjà actives" : "Cette option est déjà active");
  const results = [];
  const fresh: OptionKey[] = [];
  for (const key of wanted.filter((k) => !org.options.includes(k)) as OptionKey[]) {
    const existing = await prisma.optionRequest.findFirst({ where: { organizationId: actor.organizationId, option: key, status: "PENDING" } });
    if (existing) { results.push(existing); continue; }
    const req = await prisma.optionRequest.create({ data: { organizationId: actor.organizationId, option: key, requestedById: actor.userId } });
    await audit({ ...actor, action: "option.request", entityType: "organization", entityId: actor.organizationId, newValue: { option: key } });
    results.push(req);
    fresh.push(key);
  }
  if (fresh.length && isEmailConfigured()) {
    const who = await prisma.user.findUnique({ where: { id: actor.userId }, select: { firstName: true, lastName: true, email: true } });
    const labels = fresh.map((k) => OPTIONS[k].label);
    await sendMail(platformMail({
      to: teamRecipients(), replyTo: who?.email ?? OFFER.contactEmail,
      subject: `${fresh.length > 1 ? "Demande d'options" : "Demande d'option"} : ${labels.join(", ")} · ${org.name}`,
      kicker: "ManaResto · console", title: fresh.length > 1 ? `${org.name} demande ${fresh.length} options` : `${org.name} demande l'option « ${labels[0]} »`,
      paragraphs: [
        ...(fresh.length > 1 ? [`Options demandées : ${labels.map((l) => `« ${l} »`).join(", ")}.`] : []),
        `Demande faite par ${who ? `${who.firstName} ${who.lastName} (${who.email})` : "le restaurant"}.`,
        "Activez les options depuis la fiche du restaurant dans la console, une fois la facturation convenue.",
      ],
      cta: { label: "Ouvrir la console", url: consoleUrl() }, footer: "Message automatique de ManaResto.",
    })).catch(() => {});
  }
  return results;
}

/** Console : options actives d'une entreprise. Les demandes en attente des options activées sont closes. */
export async function setOrganizationOptions(organizationId: string, options: string[], admin: { id: string; email: string }) {
  const next = [...new Set(options.filter(isOptionKey))].sort() as OptionKey[];
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { options: true, name: true } });
  if (!org) throw new ApiError(404, "NOT_FOUND", "Restaurant introuvable");
  await prisma.organization.update({ where: { id: organizationId }, data: { options: next } });
  await prisma.optionRequest.updateMany({ where: { organizationId, status: "PENDING", option: { in: next } }, data: { status: "DONE", handledAt: new Date() } });
  await audit({ organizationId, action: "platform.options", entityType: "organization", entityId: organizationId, oldValue: { options: org.options }, newValue: { options: next }, reason: `Console ManaResto (${admin.email})` });
  // Le propriétaire est prévenu des options nouvellement activées
  const added = next.filter((k) => !org.options.includes(k));
  if (added.length && isEmailConfigured()) {
    const owner = await prisma.user.findFirst({ where: { organizationId, isOwner: true }, orderBy: { createdAt: "asc" }, select: { email: true, firstName: true } });
    if (owner) {
      const labels = added.map((k) => OPTIONS[k].label);
      await sendMail(platformMail({
        to: owner.email, replyTo: OFFER.contactEmail, subject: added.length > 1 ? "Vos options ManaResto sont activées" : `Option « ${labels[0]} » activée`,
        kicker: `ManaResto · ${org.name}`, title: `Bonne nouvelle ${owner.firstName} : ${labels.join(", ")} ${added.length > 1 ? "sont activées" : "est activée"}`,
        paragraphs: added.map((k) => `${OPTIONS[k].label} : ${OPTIONS[k].includes.join(" · ")}.`),
        cta: { label: "Ouvrir ManaResto", url: `${appUrl()}/admin/options` }, footer: `Vous recevez cet e-mail car vous avez un compte ManaResto pour ${org.name}.`,
      })).catch(() => {});
    }
  }
  return { options: next };
}

/** Console : prix mensuel d'une option (null = « sur demande »). */
export async function setOptionPrice(key: string, monthly: number | null, admin: { id: string; email: string }) {
  if (!isOptionKey(key) && !serviceOf(key)) throw new ApiError(400, "BAD_OPTION", "Option inconnue");
  await prisma.optionPrice.upsert({ where: { option: key }, create: { option: key, monthly }, update: { monthly } });
  console.info(`[options] prix de « ${key} » réglé par ${admin.email} : ${monthly ?? "sur demande"}`);
  return { key, monthly, label: monthly === null ? "sur demande" : serviceOf(key) ? `${fmt(monthly)} (prix unique)` : `${fmt(monthly)} / mois` };
}

/** Console : demandes en attente, tous restaurants confondus */
export async function pendingOptionRequests() {
  const rows = await prisma.optionRequest.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" }, include: { organization: { select: { id: true, name: true } } } });
  return rows.map((r) => {
    const service = serviceOf(r.option);
    return { id: r.id, organizationId: r.organization.id, organizationName: r.organization.name, option: r.option, kind: service ? "service" as const : "option" as const, label: isOptionKey(r.option) ? OPTIONS[r.option].label : service ? `Service : ${SERVICES[service].label}` : r.option, createdAt: r.createdAt };
  });
}
