import { route, ok } from "@/server/http";
import { requireAccounts } from "@/server/accounts-auth";
import { actorFrom } from "@/server/auth/authorize";
import { remindInvoice } from "@/server/services/accounts";

/** Relance par e-mail (facture PDF jointe) d'une facture non réglée. */
export const POST = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requireAccounts("manage");
  return ok(await remindInvoice(actorFrom(ctx), params.id));
});
