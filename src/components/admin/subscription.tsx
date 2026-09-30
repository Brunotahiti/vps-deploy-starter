"use client";

import Link from "next/link";
import { Sparkles, AlertTriangle, BadgeCheck, Mail } from "lucide-react";
import { useSession } from "@/hooks/use-session";
import { OFFER } from "@/lib/plan";
import { formatMoney } from "@/lib/money";
import { Card } from "@/components/ui/misc";

const fmt = (v: number) => formatMoney(v, "XPF");

/** Bandeau discret : jours d'essai restants, ou essai terminé. Rien pendant un abonnement actif. */
export function SubscriptionBanner() {
  const { me, can } = useSession();
  const s = me?.subscription;
  if (!s || s.plan === "ACTIVE") return null;
  const tone = s.expired ? "bg-red-600 text-white" : (s.daysLeft ?? 99) <= 3 ? "bg-corail-500 text-white" : "bg-lagon-500/12 text-lagon-800 dark:text-lagon-200";
  return (
    <div className={`mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl px-4 py-2.5 text-sm ${tone}`} role="status" data-testid="subscription-banner">
      {s.expired ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <Sparkles className="h-4 w-4 shrink-0" />}
      <span className="font-bold">{s.label}</span>
      <span className="opacity-90">{s.expired ? "Activez votre abonnement pour continuer sereinement : vos données sont conservées." : `Sans carte bancaire · ensuite ${fmt(OFFER.monthly)} par mois, engagement ${OFFER.commitmentMonths} mois, ${OFFER.commission} % de commission sur vos ventes.`}</span>
      {can("settings.manage") ? <Link href="/admin/settings#abonnement" className={`ml-auto rounded-lg px-3 py-1 text-xs font-bold ${s.expired || (s.daysLeft ?? 99) <= 3 ? "bg-white/20" : "bg-lagon-600 text-white"}`}>Voir l&apos;offre</Link> : null}
    </div>
  );
}

/** Carte « Abonnement » des paramètres : état, tarif et contact pour activer. */
export function SubscriptionCard() {
  const { me } = useSession();
  const s = me?.subscription;
  if (!s) return null;
  const subject = encodeURIComponent(`Activation ManaResto — ${me?.establishment?.name ?? ""}`);
  const body = encodeURIComponent(`Bonjour,\n\nJe souhaite activer mon abonnement ManaResto pour ${me?.establishment?.name ?? "mon restaurant"}.\nCompte : ${me?.user?.email ?? ""}\n\nMerci.`);
  return (
    <div id="abonnement">
      <Card title="Abonnement">
        <div className="grid gap-4 md:grid-cols-[1fr_1.2fr]">
          <div className={`rounded-2xl p-4 ${s.plan === "ACTIVE" ? "bg-green-500/12" : s.expired ? "bg-red-500/12" : "surface-2"}`}>
            <p className="flex items-center gap-2 text-sm font-extrabold">{s.plan === "ACTIVE" ? <BadgeCheck className="h-4 w-4 text-green-600" /> : s.expired ? <AlertTriangle className="h-4 w-4 text-red-600" /> : <Sparkles className="h-4 w-4 text-lagon-600" />}{s.label}</p>
            {s.plan === "TRIAL" && s.trialEndsAt ? <p className="mt-1 text-xs text-muted">Fin de l&apos;essai le {new Date(s.trialEndsAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}. Toutes les fonctions sont incluses pendant l&apos;essai.</p> : null}
            {s.plan === "ACTIVE" ? <p className="mt-1 text-xs text-muted">Merci de votre confiance. Facturation mensuelle, engagement {OFFER.commitmentMonths} mois.</p> : null}
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted">Tarif</p>
            <ul className="mt-1 space-y-1 text-sm">
              <li><b>{OFFER.trialDays} jours d&apos;essai gratuits</b>, sans carte bancaire</li>
              <li><b>{fmt(OFFER.monthly)} par mois</b>, engagement {OFFER.commitmentMonths} mois, toutes fonctions, établissements et appareils compris</li>
              <li><b>{OFFER.commission} % de commission</b> sur vos ventes, en salle comme en ligne</li>
            </ul>
            {s.plan !== "ACTIVE" ? <a href={`mailto:${OFFER.contactEmail}?subject=${subject}&body=${body}`} className="mt-3 inline-flex h-11 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-bold text-white shadow-glow"><Mail className="h-4 w-4" />Activer mon abonnement</a> : null}
            <p className="mt-2 text-[11px] text-muted">Contact : {OFFER.contactEmail} · {OFFER.siteUrl.replace("https://", "")}</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
