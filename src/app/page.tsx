import { redirect } from "next/navigation";
import { getAuthContext } from "@/server/auth/context";
import { getTerminalFromCookie } from "@/server/auth/session";
import { hasPermission } from "@/lib/permissions";
import { profileHome } from "@/lib/profiles";

export const dynamic = "force-dynamic";

export default async function Home() {
  const ctx = await getAuthContext();
  if (!ctx) {
    const terminal = await getTerminalFromCookie();
    redirect(!terminal ? "/login" : terminal.kind === "KDS" ? "/kds/login" : "/pos/login");
  }
  if (ctx.establishment && !ctx.establishment.onboardingDone && ctx.user.isOwner) redirect("/onboarding");
  // Chaque profil arrive sur son écran : Chef en cuisine → cuisine, Équipe en salle → salle, Admin et Gérant → gestion
  const home = profileHome(ctx.roleKey, ctx.user.isOwner);
  if (home) redirect(home);
  if (hasPermission(ctx.permissions, "pos.use")) redirect("/pos");
  if (hasPermission(ctx.permissions, "kds.use") && !hasPermission(ctx.permissions, "reports.view")) redirect("/kds");
  redirect("/admin");
}
