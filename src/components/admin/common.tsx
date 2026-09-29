"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiClientError } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";

export function useList<T>(key: string[], url: string, enabled = true) {
  return useQuery({ queryKey: key, queryFn: () => api.get<T>(url), enabled });
}

/** Exécute une mutation, affiche le résultat, invalide les clés. */
export function useAction() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return async <T,>(fn: () => Promise<T>, opts: { success?: string; invalidate?: string[][] } = {}): Promise<T | null> => {
    try {
      const r = await fn();
      if (opts.success) toast(opts.success, "success");
      for (const k of opts.invalidate ?? []) qc.invalidateQueries({ queryKey: k });
      return r;
    } catch (e) {
      toast(e instanceof ApiClientError ? (e.details && Array.isArray(e.details) ? `${e.message} : ${(e.details as { path: unknown[]; message: string }[]).map((d) => `${d.path.join(".")} ${d.message}`).join(", ")}` : e.message) : "Erreur", "error");
      return null;
    }
  };
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-[26px] font-extrabold tracking-tight">{title}</h1>{subtitle ? <p className="mt-0.5 text-sm text-muted">{subtitle}</p> : null}</div>
      {action}
    </div>
  );
}

export function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted">{head.map((h, i) => <th key={i} className="px-4 py-3 font-bold">{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
export const Tr = ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => <tr onClick={onClick} className={`border-b border-line last:border-0 ${onClick ? "cursor-pointer hover:surface-2" : ""}`}>{children}</tr>;
export const Td = ({ children, className = "", title }: { children?: React.ReactNode; className?: string; title?: string }) => <td title={title} className={`px-4 py-2.5 align-middle ${className}`}>{children}</td>;

export function Tabs({ tabs }: { tabs: { href: string; label: string; active: boolean }[] }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => <a key={t.href} href={t.href} className={`shrink-0 border-b-2 px-3 py-2 text-sm font-semibold ${t.active ? "border-lagon-500 text-lagon-600" : "border-transparent text-muted hover:text-[var(--text)]"}`}>{t.label}</a>)}
    </div>
  );
}
