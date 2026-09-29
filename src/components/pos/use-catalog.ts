"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { cacheGet, cacheSet } from "@/lib/offline/db";
import type { PosCatalog } from "./types";

/** Catalogue POS : réseau, puis cache IndexedDB en secours (mode hors ligne). */
export function usePosCatalog(enabled = true) {
  return useQuery({
    queryKey: ["pos-catalog"],
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      try {
        const data = await api.get<PosCatalog>("/api/pos/catalog");
        cacheSet("pos-catalog", data).catch(() => {});
        return data;
      } catch (err) {
        const cached = await cacheGet<PosCatalog>("pos-catalog");
        if (cached) return cached.data;
        throw err;
      }
    },
  });
}
