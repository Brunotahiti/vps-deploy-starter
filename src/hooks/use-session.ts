"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { Establishment } from "@/generated/prisma/client";

export type Me = {
  user: { id: string; email: string; firstName: string; lastName: string; displayName: string | null; color: string | null; isOwner: boolean; hasPin: boolean } | null;
  organizationId?: string;
  establishment?: Establishment | null;
  establishments?: { id: string; name: string; slug: string; roleKey: string }[];
  roleKey?: string | null;
  permissions?: string[];
  terminal: { id: string; name: string; kind: string; establishmentId: string } | null;
  features?: { email: boolean };
  subscription?: import("@/lib/plan").SubscriptionInfo;
  platformAdmin?: boolean;
  impersonation?: { by: string } | null;
};

export function useSession() {
  const q = useQuery({ queryKey: ["me"], queryFn: () => api.get<Me>("/api/auth/me"), staleTime: 60_000 });
  const perms = new Set(q.data?.permissions ?? []);
  const can = (key: string) => perms.has("*") || perms.has(key);
  return { ...q, me: q.data, can, currency: q.data?.establishment?.currency ?? "XPF", timezone: q.data?.establishment?.timezone ?? "Pacific/Tahiti" };
}
