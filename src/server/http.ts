import * as Sentry from "@sentry/nextjs";
import { NextResponse, type NextRequest } from "next/server";
import { z, type ZodType } from "zod";
import { ApiError } from "./errors";

export type RouteContext<P = Record<string, string>> = { params: Promise<P> };

type Handler<P> = (req: NextRequest, ctx: { params: P }) => Promise<Response | NextResponse>;

/** Enveloppe un route handler : erreurs typées → JSON, erreurs zod → 400. */
export function route<P = Record<string, string>>(handler: Handler<P>) {
  return async (req: NextRequest, ctx: RouteContext<P>) => {
    try {
      const params = await ctx.params;
      return await handler(req, { params });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function errorResponse(err: unknown) {
  if (err instanceof ApiError) {
    const retry = (err.details as { retryAfter?: number } | undefined)?.retryAfter;
    return NextResponse.json({ error: { code: err.code, message: err.message, details: err.details ?? null } }, { status: err.status, headers: err.status === 429 && retry ? { "Retry-After": String(retry) } : undefined });
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json(
      { error: { code: "VALIDATION", message: "Données invalides", details: err.issues } },
      { status: 400 },
    );
  }
  const anyErr = err as { code?: string; message?: string };
  if (anyErr?.code === "P2002") {
    return NextResponse.json({ error: { code: "CONFLICT", message: "Cette valeur existe déjà" } }, { status: 409 });
  }
  if (anyErr?.code === "P2025") {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Ressource introuvable" } }, { status: 404 });
  }
  // Le visiteur a fermé la page ou perdu le réseau pendant l'envoi (balise de fin de visite, onglet fermé) :
  // ce n'est pas une panne du serveur, rien à signaler à Sentry.
  if (isClientAbort(err)) return new NextResponse(null, { status: 499 });
  console.error("[api] erreur non gérée", err);
  Sentry.captureException(err);
  return NextResponse.json({ error: { code: "INTERNAL", message: "Erreur interne" } }, { status: 500 });
}

/** Connexion coupée par le client pendant la lecture de la requête (Node : « aborted », ECONNRESET ; undici : UND_ERR_ABORTED). */
export function isClientAbort(err: unknown): boolean {
  for (let e = err as { name?: string; code?: string; message?: string; cause?: unknown } | undefined, depth = 0; e && depth < 4; e = e.cause as typeof e, depth++) {
    if (e.name === "AbortError" || e.name === "ResponseAborted" || e.code === "ECONNRESET" || e.code === "UND_ERR_ABORTED" || e.message === "aborted") return true;
  }
  return false;
}

export async function parseBody<T extends ZodType>(req: NextRequest, schema: T): Promise<z.infer<T>> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw new ApiError(400, "BAD_JSON", "Corps JSON invalide");
  }
  return schema.parse(json);
}

export function parseQuery<T extends ZodType>(req: NextRequest, schema: T): z.infer<T> {
  const obj: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((v, k) => (obj[k] = v));
  return schema.parse(obj);
}

export const ok = <T>(data: T, init?: ResponseInit) => NextResponse.json({ data }, init);
export const created = <T>(data: T) => NextResponse.json({ data }, { status: 201 });

/** En-tête Content-Disposition sûr pour un nom de fichier accentué (ex. « Pōtē ») : repli ASCII + nom UTF-8 (RFC 6266). */
export function contentDisposition(kind: "inline" | "attachment", filename: string) {
  const ascii = filename.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
