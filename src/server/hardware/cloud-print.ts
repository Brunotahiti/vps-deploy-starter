import { prisma } from "@/server/db";
import { sha256 } from "@/server/auth/password";
import { encodeEposXml, encodeStar, encodeText, type PrintOp } from "./escpos";
import type { Printer, PrintJob } from "@/generated/prisma/client";

/**
 * Imprimantes connectées : l'imprimante du restaurant interroge ManaResto à intervalle régulier
 * (aucun port à ouvrir, fonctionne avec le serveur hébergé).
 *  - Epson Server Direct Print : POST formulaire « GetRequest » → travaux en ePOS-Print XML ; « SetResponse » → résultat.
 *  - Star CloudPRNT : POST JSON (état) → { jobReady } ; GET → travail ; DELETE → résultat.
 * L'adresse contient un jeton secret propre à l'imprimante (seule son empreinte est stockée).
 */
const PENDING_TTL_MS = 15 * 60_000; // un ticket plus ancien n'a plus de sens (client parti, plat servi)
const SENT_TTL_MS = 2 * 60_000; // envoyé sans confirmation : on ne le renvoie pas (risque de double ticket)
export const STAR_MEDIA_TYPES = ["application/vnd.star.starprnt", "application/vnd.star.line", "text/plain"];

export async function findCloudPrinter(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  return prisma.printer.findFirst({ where: { cloudTokenHash: sha256(token), isActive: true, driver: { in: ["cloud-epson", "cloud-star"] }, establishment: { isActive: true, organization: { blockedAt: null } } } });
}

/** Note le passage de l'imprimante (au plus toutes les 10 s, ou quand son état change) et fait expirer les travaux trop anciens. */
async function touch(printer: Printer, status?: string | null) {
  const now = Date.now();
  if (!printer.lastSeenAt || now - printer.lastSeenAt.getTime() > 10_000 || (status != null && status !== printer.lastStatus)) {
    await prisma.printer.update({ where: { id: printer.id }, data: { lastSeenAt: new Date(now), ...(status != null ? { lastStatus: status.slice(0, 120) } : {}) } });
    await prisma.printJob.updateMany({ where: { printerId: printer.id, status: "PENDING", createdAt: { lt: new Date(now - PENDING_TTL_MS) } }, data: { status: "FAILED", error: "Expiré : l'imprimante ne s'est pas connectée à temps", doneAt: new Date(now) } });
    await prisma.printJob.updateMany({ where: { printerId: printer.id, status: "SENT", sentAt: { lt: new Date(now - SENT_TTL_MS) } }, data: { status: "FAILED", error: "Aucune confirmation de l'imprimante", doneAt: new Date(now) } });
  }
}

/** Réserve les plus anciens travaux en attente (chaque travail n'est remis qu'une fois, même si deux requêtes se croisent). */
async function claim(printerId: string, limit: number, id?: string): Promise<PrintJob[]> {
  const jobs = await prisma.printJob.findMany({ where: { printerId, status: "PENDING", ...(id ? { id } : {}) }, orderBy: { createdAt: "asc" }, take: limit });
  const out: PrintJob[] = [];
  for (const j of jobs) {
    const r = await prisma.printJob.updateMany({ where: { id: j.id, status: "PENDING" }, data: { status: "SENT", sentAt: new Date() } });
    if (r.count) out.push(j);
  }
  return out;
}

async function finish(printerId: string, id: string, ok: boolean, error?: string | null) {
  await prisma.printJob.updateMany({ where: { id, printerId, status: { in: ["PENDING", "SENT"] } }, data: { status: ok ? "DONE" : "FAILED", error: ok ? null : (error || "Erreur d'impression").slice(0, 200), doneAt: new Date() } });
}

const isUuid = (s: string | null | undefined): s is string => !!s && /^[0-9a-f-]{36}$/i.test(s);

// ---------------------------------------------------------------- Epson Server Direct Print

export async function handleEpson(printer: Printer, form: URLSearchParams): Promise<Response> {
  if (form.get("ConnectionType") === "SetResponse") {
    const file = form.get("ResponseFile") ?? "";
    let failed: string | null = null;
    for (const part of file.split(/<ePOSPrint>/i).slice(1)) {
      const id = /<printjobid>([^<]+)<\/printjobid>/i.exec(part)?.[1]?.trim();
      const res = /<response\b([^>]*)>/i.exec(part)?.[1] ?? "";
      const ok = /success\s*=\s*"true"/i.test(res);
      const code = /code\s*=\s*"([^"]*)"/i.exec(res)?.[1] || null;
      if (!ok) failed = code ?? "Erreur";
      if (isUuid(id)) await finish(printer.id, id, ok, code);
    }
    await touch(printer, failed ? `Erreur : ${failed}` : "Prête");
    return new Response("", { status: 200 });
  }
  await touch(printer);
  const jobs = await claim(printer.id, 5);
  if (jobs.length === 0) return new Response("", { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } });
  const body = `<?xml version="1.0" encoding="utf-8"?><PrintRequestInfo Version="2.00">${jobs.map((j) => `<ePOSPrint><Parameter><devid>local_printer</devid><timeout>10000</timeout><printjobid>${j.id}</printjobid></Parameter><PrintData>${encodeEposXml(j.document as PrintOp[])}</PrintData></ePOSPrint>`).join("")}</PrintRequestInfo>`;
  return new Response(body, { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } });
}

// ---------------------------------------------------------------- Star CloudPRNT

/** Interrogation : l'imprimante envoie son état ; on lui indique si un travail l'attend. */
export async function handleStarPoll(printer: Printer, body: { statusCode?: string; printingInProgress?: boolean } | null): Promise<Response> {
  const status = body?.statusCode ? decodeURIComponent(body.statusCode) : null;
  await touch(printer, status ? (status.startsWith("2") ? "Prête" : status) : null);
  const next = body?.printingInProgress ? null : await prisma.printJob.findFirst({ where: { printerId: printer.id, status: "PENDING" }, orderBy: { createdAt: "asc" }, select: { id: true } });
  return Response.json(next ? { jobReady: true, mediaTypes: STAR_MEDIA_TYPES, jobToken: next.id } : { jobReady: false });
}

/** Récupération du travail, encodé dans le format choisi par l'imprimante. */
export async function handleStarFetch(printer: Printer, params: URLSearchParams): Promise<Response> {
  const token = params.get("token");
  const [job] = await claim(printer.id, 1, isUuid(token) ? token : undefined);
  if (!job) return new Response("", { status: 404 });
  const type = params.get("type") ?? STAR_MEDIA_TYPES[0];
  const ops = job.document as PrintOp[];
  if (type === "text/plain") return new Response(encodeText(ops), { status: 200, headers: { "Content-Type": "text/plain; charset=us-ascii" } });
  return new Response(Buffer.from(encodeStar(ops)), { status: 200, headers: { "Content-Type": STAR_MEDIA_TYPES.includes(type) ? type : STAR_MEDIA_TYPES[0] } });
}

/** Fin d'impression : code 2xx = réussi. */
export async function handleStarDone(printer: Printer, params: URLSearchParams): Promise<Response> {
  const token = params.get("token");
  const code = decodeURIComponent(params.get("code") ?? "200");
  const job = isUuid(token)
    ? { id: token }
    : await prisma.printJob.findFirst({ where: { printerId: printer.id, status: "SENT" }, orderBy: { sentAt: "asc" }, select: { id: true } });
  if (job) await finish(printer.id, job.id, code.startsWith("2"), code);
  await touch(printer, code.startsWith("2") ? "Prête" : `Erreur : ${code}`);
  return new Response("", { status: 200 });
}
