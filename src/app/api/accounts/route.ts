import { route, ok, created, parseBody } from "@/server/http";
import { requireAccounts } from "@/server/accounts-auth";
import { actorFrom } from "@/server/auth/authorize";
import { customerAccountSchema } from "@/server/schemas";
import { listAccounts, upsertAccount } from "@/server/services/accounts";

export const GET = route(async () => {
  const ctx = await requireAccounts("manage");
  return ok(await listAccounts(ctx.establishment.id));
});
export const POST = route(async (req) => {
  const ctx = await requireAccounts("manage");
  return created(await upsertAccount(actorFrom(ctx), await parseBody(req, customerAccountSchema)));
});
