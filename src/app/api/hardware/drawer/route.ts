import { route, parseBody, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { drawerOpenSchema } from "@/server/schemas";
import { findDrawerPrinter, openDrawer } from "@/server/hardware/printers";

/** Le tiroir-caisse est-il configuré pour cette caisse ? (affiche ou masque le bouton) */
export const GET = route(async () => {
  const ctx = await requirePermission("pos.use");
  const p = await findDrawerPrinter(ctx.establishment.id, ctx.terminal?.id);
  return ok({ available: !!p, printer: p ? { id: p.id, name: p.name, driver: p.driver } : null });
});

/** Ouverture du tiroir sans vente (rendu de monnaie, change) : permission dédiée, tracée avec son motif. */
export const POST = route(async (req) => {
  const ctx = await requirePermission("pos.open_drawer");
  const body = await parseBody(req, drawerOpenSchema);
  return ok(await openDrawer(actorFrom(ctx), { trigger: "manual", reason: body.reason ?? null }));
});
