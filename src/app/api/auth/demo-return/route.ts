import { route, ok } from "@/server/http";
import { returnFromDemo } from "@/server/services/demo-session";

/** « Revenir à mon restaurant » : quitte le restaurant exemple et retrouve sa propre session. */
export const POST = route(async () => {
  await returnFromDemo();
  return ok({ redirect: "/admin" });
});
