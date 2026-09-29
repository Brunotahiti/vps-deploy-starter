import { route, parseBody, created } from "@/server/http";
import { signupSchema } from "@/server/schemas";
import { signup } from "@/server/services/auth";

export const POST = route(async (req) => {
  const body = await parseBody(req, signupSchema);
  const r = await signup(body);
  return created({ organizationId: r.org.id, establishmentId: r.est.id, userId: r.owner.id });
});
