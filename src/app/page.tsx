import { redirect } from "next/navigation";
import { getAuthContext } from "@/server/auth/context";
import { getTerminalFromCookie } from "@/server/auth/session";
import { hasPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function Home() {
  const ctx = await getAuthContext();
  if (!ctx) {
    const terminal = await getTerminalFromCookie();
    redirect(!terminal ? "/login" : terminal.kind === "KDS" ? "/kds/login" : "/pos/login");
  }
  if (ctx.establishment && !ctx.establishment.onboardingDone && ctx.user.isOwner) redirect("/onboarding");
  if (ctx.roleKey === "kitchen") redirect("/kds");
  if (hasPermission(ctx.permissions, "pos.use") && !ctx.user.isOwner && ctx.roleKey !== "manager") redirect("/pos");
  redirect("/admin");
}
