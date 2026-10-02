import { route, ok } from "@/server/http";
import { requireAccounts } from "@/server/accounts-auth";
import { accountsForPos } from "@/server/services/accounts";

/** Comptes ouverts, pour « Sur compte » à la caisse : nom, encours et disponible sous le plafond. */
export const GET = route(async () => {
  const ctx = await requireAccounts("charge");
  return ok(await accountsForPos(ctx.establishment.id));
});
