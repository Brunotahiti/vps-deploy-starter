import { route, ok, parseBody } from "@/server/http";
import { requireAccounts } from "@/server/accounts-auth";
import { actorFrom } from "@/server/auth/authorize";
import { customerAccountSchema } from "@/server/schemas";
import { getAccount, upsertAccount } from "@/server/services/accounts";

export const GET = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requireAccounts("manage");
  return ok(await getAccount(ctx.establishment.id, params.id));
});
export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requireAccounts("manage");
  return ok(await upsertAccount(actorFrom(ctx), { id: params.id, ...(await parseBody(req, customerAccountSchema)) }));
});
