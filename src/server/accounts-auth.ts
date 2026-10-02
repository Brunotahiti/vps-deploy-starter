import { can, requireEstablishment, requireOption } from "@/server/auth/context";
import { ApiError } from "@/server/errors";

/** Comptes clients : option « accounts » débloquée, puis « charge » (caisse) ou « manage » (factures, règlements). */
export async function requireAccounts(level: "charge" | "manage") {
  const ctx = await requireEstablishment();
  requireOption(ctx, "accounts");
  const allowed = level === "manage" ? can(ctx, "accounts.manage") : can(ctx, "accounts.charge") || can(ctx, "accounts.manage");
  if (!allowed) throw new ApiError(403, "FORBIDDEN", `Permission requise : accounts.${level}`, { permission: `accounts.${level}` });
  return ctx;
}
