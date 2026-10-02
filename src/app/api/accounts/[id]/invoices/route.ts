import { route, created, parseBody } from "@/server/http";
import { requireAccounts } from "@/server/accounts-auth";
import { actorFrom } from "@/server/auth/authorize";
import { invoiceCreateSchema } from "@/server/schemas";
import { createInvoice } from "@/server/services/accounts";

/** Facture les consommations sur compte pas encore facturées (jusqu'au jour indiqué inclus). */
export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requireAccounts("manage");
  return created(await createInvoice(actorFrom(ctx), params.id, await parseBody(req, invoiceCreateSchema)));
});
