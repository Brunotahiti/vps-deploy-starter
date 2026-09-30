import { route, ok } from "@/server/http";
import { requirePlatformAdmin } from "@/server/auth/platform";
import { runLifecycleEmails } from "@/server/services/platform-emails";

/** Lance tout de suite les relances automatiques (rappel J-3, essai expiré). */
export const POST = route(async () => {
  await requirePlatformAdmin();
  return ok(await runLifecycleEmails());
});
