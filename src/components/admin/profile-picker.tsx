"use client";

import { useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { PROFILES, PROFILE_BY_KEY } from "@/lib/profiles";
import { SYSTEM_ROLES } from "@/lib/permissions";

type Role = { id: string; key: string; name: string };

/** Nom lisible d'un rôle à partir de sa clé (barre latérale, badges). */
export function roleLabel(key: string | null | undefined) {
  if (!key) return "";
  return PROFILE_BY_KEY[key]?.name ?? SYSTEM_ROLES[key]?.name ?? key;
}

/** Badge du profil : emoji + nom ; rôle spécialisé ou sur mesure : nom seul. */
export function ProfileBadge({ roleKey, name, suffix }: { roleKey: string; name: string; suffix?: string }) {
  const p = PROFILE_BY_KEY[roleKey];
  return (
    <span className="mr-1 inline-flex items-center gap-1 rounded-full surface-2 px-2 py-0.5 text-xs font-semibold">
      {p ? <span aria-hidden>{p.emoji}</span> : null}{p?.name ?? name}{suffix ? <span className="font-normal text-muted">{suffix}</span> : null}
    </span>
  );
}

/**
 * Choix du profil d'un membre : les quatre profils en grandes cartes, les autres rôles (caisse, bar, comptable,
 * rôles sur mesure) dans une liste. Le profil Admin n'est proposé qu'à ceux qui peuvent le donner.
 */
export function ProfilePicker({ roles, value, onChange, canGiveAdmin }: { roles: Role[]; value: string; onChange: (roleId: string) => void; canGiveAdmin: boolean }) {
  const byKey = new Map(roles.map((r) => [r.key, r]));
  const main = PROFILES.filter((p) => byKey.has(p.key) && (p.key !== "admin" || canGiveAdmin));
  const others = roles.filter((r) => !PROFILE_BY_KEY[r.key]);
  const current = roles.find((r) => r.id === value);
  const [showOthers, setShowOthers] = useState<boolean>(!!current && !PROFILE_BY_KEY[current.key]);
  return (
    <div className="space-y-2" role="radiogroup" aria-label="Profil">
      <div className="grid grid-cols-2 gap-2">
        {main.map((p) => {
          const role = byKey.get(p.key)!;
          const on = role.id === value;
          return (
            <button key={p.key} type="button" role="radio" aria-checked={on} onClick={() => onChange(role.id)} data-testid={`profile-${p.key}`}
              className={`relative rounded-2xl border-2 p-3 text-left transition active:scale-[0.98] ${on ? "border-lagon-500 bg-lagon-500/10 shadow-[0_8px_24px_-12px_rgb(20_170_163/0.7)]" : "border-line hover:border-lagon-300 hover:surface-2"}`}>
              <span className={`mb-1.5 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br text-xl ${p.tile}`} aria-hidden>{p.emoji}</span>
              <span className="block text-sm font-extrabold leading-tight">{p.name}</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-muted">{p.tagline}</span>
              {on ? <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-lagon-500 text-white"><Check className="h-3 w-3" /></span> : null}
            </button>
          );
        })}
      </div>
      {others.length ? (
        showOthers ? (
          <label className="block text-xs">
            <span className="mb-1 block font-semibold text-muted">Autre profil</span>
            <select value={others.some((r) => r.id === value) ? value : ""} onChange={(e) => e.target.value && onChange(e.target.value)} className="h-10 w-full rounded-xl border border-line surface px-3 text-sm">
              <option value="">Choisir…</option>
              {others.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
        ) : (
          <button type="button" onClick={() => setShowOthers(true)} className="inline-flex items-center gap-1 text-xs font-semibold text-lagon-600">Autres profils (caisse, bar, comptable…) <ChevronDown className="h-3.5 w-3.5" /></button>
        )
      ) : null}
    </div>
  );
}

/** Qui peut faire quoi : les quatre profils côte à côte. */
export function ProfilesGuide({ onClose }: { onClose?: () => void }) {
  return (
    <section className="card mb-4 p-4 sm:p-5" data-testid="profiles-guide">
      <header className="mb-3 flex items-start justify-between gap-2">
        <div><h2 className="text-base font-extrabold tracking-tight">Qui peut faire quoi ?</h2><p className="text-xs text-muted">Choisissez un profil pour chaque personne : elle ne voit que ce dont elle a besoin.</p></div>
        {onClose ? <button onClick={onClose} className="touch flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:surface-2" aria-label="Masquer"><X className="h-4 w-4" /></button> : null}
      </header>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {PROFILES.map((p) => (
          <article key={p.key} className="rounded-2xl border border-line p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-xl ${p.tile}`} aria-hidden>{p.emoji}</span>
              <div className="min-w-0"><h3 className="text-sm font-extrabold">{p.name}</h3><p className="text-[11px] leading-snug text-muted">{p.tagline}</p></div>
            </div>
            <ul className="space-y-1 text-xs">
              {p.can.map((c) => <li key={c} className="flex gap-1.5"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />{c}</li>)}
              {p.cannot.map((c) => <li key={c} className="flex gap-1.5 text-muted"><X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />{c}</li>)}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
