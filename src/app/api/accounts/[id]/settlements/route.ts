import { route, created, parseBody } from "@/server/http";
import { requireAccounts } from "@/server/accounts-auth";
import { actorFrom } from "@/server/auth/authorize";
import { settlementSchema } from "@/server/schemas";
import { recordSettlement } from "@/server/services/accounts";

/** Règlement reçu (chèque, virement, espèces, carte) : il solde les factures les plus anciennes d'abord. */
export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requireAccounts("manage");
  return created(await recordSettlement(actorFrom(ctx), params.id, await parseBody(req, settlementSchema)));
});
