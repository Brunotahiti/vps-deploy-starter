import { route, ok, parseBody } from "@/server/http";
import { requireCatering } from "@/server/catering-auth";
import { actorFrom } from "@/server/auth/authorize";
import { eventInvoiceSchema } from "@/server/schemas";
import { invoiceEvent } from "@/server/services/catering";

/** Facture finale de l'événement (acomptes déduits). */
export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requireCatering("manage");
  return ok(await invoiceEvent(actorFrom(ctx), params.id, await parseBody(req, eventInvoiceSchema)));
});
