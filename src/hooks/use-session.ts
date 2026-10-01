"use client";

import { useQuery } from "@tanstack/react-query";
import { api, ApiClientError } from "@/lib/api-client";
import { getActivePass, setKnownPermissions } from "@/lib/offline/auth-state";
import { getStoredPasses, loadActivePass, offlineMe, setActivePass } from "@/lib/offline/passes";
import { cacheGet, cacheSet } from "@/lib/offline/db";
import type { Establishment } from "@/generated/prisma/client";

export type Me = {
  user: { id: string; email: string; firstName: string; lastName: string; displayName: string | null; color: string | null; isOwner: boolean; hasPin: boolean } | null;
  organizationId?: string;
  establishment?: Establishment | null;
  establishments?: { id: string; name: string; slug: string; roleKey: string }[];
  roleKey?: string | null;
  permissions?: string[];
  terminal: { id: string; name: string; kind: string; establishmentId: string; establishmentName?: string } | null;
  features?: { email: boolean };
  subscription?: import("@/lib/plan").SubscriptionInfo;
  platformAdmin?: boolean;
  impersonation?: { by: string } | null;
};

/** Copie locale du profil (IndexedDB), effacée à la déconnexion (purgeLocalData). */
export const ME = "me";
const isNetwork = (e: unknown) => e instanceof ApiClientError && (e.isNetwork || e.code === "OFFLINE");

/**
 * Profil de la personne connectée. Employé connecté par PIN sans internet : profil construit sur la tablette,
 * puis échangé contre une vraie session dès le retour du réseau.
 */
const LOGOUT_PENDING = "mr-logout-pending";

/** « Changer d'utilisateur » fait sans internet : la déconnexion du serveur sera faite au retour du réseau. */
export function markLogoutPending() {
  try { localStorage.setItem(LOGOUT_PENDING, "1"); } catch { /* stockage indisponible */ }
}

async function finishPendingLogout() {
  try { if (localStorage.getItem(LOGOUT_PENDING) !== "1") return; } catch { return; }
  await api.post("/api/auth/logout");
  try { localStorage.removeItem(LOGOUT_PENDING); } catch { /* stockage indisponible */ }
}

async function loadMe(): Promise<Me> {
  // La session de l'employé précédent ne doit pas revenir avec le réseau
  await finishPendingLogout().catch(() => {});
  const active = getActivePass() ?? (await loadActivePass().catch(() => null));
  if (active?.mode === "offline") {
    try {
      await api.post("/api/auth/offline-session");
      await setActivePass({ ...active, mode: "online" });
    } catch (e) {
      const stored = await getStoredPasses();
      if (isNetwork(e) && stored) return offlineMe(active, stored);
      await setActivePass(null); // laissez-passer refusé (révoqué, expiré) : retour au portail
    }
  }
  try {
    const me = await api.get<Me>("/api/auth/me");
    const current = getActivePass();
    if (current && current.userId !== me.user?.id) await setActivePass(null); // une autre personne s'est connectée
    setKnownPermissions(me.permissions ?? []);
    cacheSet(ME, me.user ? me : null).catch(() => {}); // pour démarrer sans internet (effacé au changement d'utilisateur)
    return me;
  } catch (e) {
    if (!isNetwork(e)) throw e;
    // Sans réseau : dernier profil de la personne connectée, sinon (après « Changer d'utilisateur ») la tablette
    // reste un terminal connu et affiche son portail PIN
    const saved = (await cacheGet<Me>(ME).catch(() => null))?.data;
    if (saved?.user) { setKnownPermissions(saved.permissions ?? []); return saved; }
    const stored = await getStoredPasses();
    if (stored) return { user: null, terminal: stored.terminal };
    throw e;
  }
}

export function useSession() {
  const q = useQuery({ queryKey: ["me"], queryFn: loadMe, staleTime: 60_000 });
  const perms = new Set(q.data?.permissions ?? []);
  const can = (key: string) => perms.has("*") || perms.has(key);
  return { ...q, me: q.data, can, currency: q.data?.establishment?.currency ?? "XPF", timezone: q.data?.establishment?.timezone ?? "Pacific/Tahiti" };
}
