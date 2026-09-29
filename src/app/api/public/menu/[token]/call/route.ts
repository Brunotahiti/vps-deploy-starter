import { route, ok, parseBody } from "@/server/http";
import { callWaiterSchema } from "@/server/schemas";
import { callWaiter } from "@/server/services/public";

export const POST = route<{ token: string }>(async (req, { params }) => {
  const body = await parseBody(req, callWaiterSchema).catch(() => ({ reason: null }));
  return ok(await callWaiter(params.token, body.reason));
});
