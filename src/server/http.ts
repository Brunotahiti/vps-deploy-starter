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
  console.error("[api] erreur non gérée", err);
  return NextResponse.json({ error: { code: "INTERNAL", message: "Erreur interne" } }, { status: 500 });
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
