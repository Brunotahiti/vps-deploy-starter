import { route, parseBody, ok } from "@/server/http";
import { loginSchema } from "@/server/schemas";
import { loginWithPassword } from "@/server/services/auth";

export const POST = route(async (req) => {
  const body = await parseBody(req, loginSchema);
  const user = await loginWithPassword(body.email, body.password, body.establishmentId);
  return ok({ id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName });
});
