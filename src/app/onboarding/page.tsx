"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Logo } from "@/components/brand";
import { Spinner } from "@/components/ui/misc";
import { useAction } from "@/components/admin/common";
import { Check } from "lucide-react";

const STEPS = ["Entreprise", "Établissement", "Adresse", "N° Tahiti", "TVA", "Horaires", "Salles", "Tables", "Menu", "Utilisateurs", "Imprimantes", "Cuisine", "Paiements", "Test de commande", "Mise en production"];

export default function Onboarding() {
  const { me, isLoading } = useSession();
  const est = me?.establishment;
  if (isLoading || !est) return <div className="flex h-screen items-center justify-center"><Spinner /></div>;
  return <Wizard key={est.id} est={est} />;
}

function Wizard({ est }: { est: NonNullable<NonNullable<ReturnType<typeof useSession>["me"]>["establishment"]> }) {
  const { refetch } = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const act = useAction();
  const [step, setStep] = useState(Math.min(est.onboardingStep, STEPS.length - 1));
  const [f, setF] = useState<Record<string, string>>({ name: est.name, addressLine1: est.addressLine1 ?? "", city: est.city ?? "", postalCode: est.postalCode ?? "", phone: est.phone ?? "", tahitiNumber: est.tahitiNumber ?? "" });

  const patch = async (body: Record<string, unknown>, next = step + 1) => {
    const r = await act(() => api.patch(`/api/establishments/${est.id}`, { ...body, onboardingStep: next }), { invalidate: [["me"]] });
    if (r) { await refetch(); setStep(next); }
  };
  const finish = async () => { await patch({ onboardingDone: true }, STEPS.length - 1); qc.clear(); router.replace("/admin"); };
  const s = (k: string) => ({ value: f[k] ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value }) });
  const link = (href: string, label: string) => <Link href={href} target="_blank" className="inline-flex h-11 items-center rounded-xl surface-2 px-4 text-sm font-semibold">{label} ↗</Link>;

  const content: Record<number, React.ReactNode> = {
    0: <p className="text-sm text-muted">Votre entreprise a été créée à l&apos;inscription. Passons à la configuration de votre établissement.</p>,
    1: <Field label="Nom de l'établissement"><Input {...s("name")} /></Field>,
    2: <div className="grid gap-3 sm:grid-cols-2"><Field label="Adresse" className="sm:col-span-2"><Input {...s("addressLine1")} /></Field><Field label="Code postal"><Input {...s("postalCode")} /></Field><Field label="Commune"><Input {...s("city")} /></Field><Field label="Téléphone"><Input {...s("phone")} /></Field></div>,
    3: <Field label="N° Tahiti" hint="Figure sur vos tickets et factures"><Input {...s("tahitiNumber")} placeholder="A12345" /></Field>,
    4: <div className="space-y-2"><p className="text-sm text-muted">Des taux de départ (restauration 13 %, normal 16 %, réduit 5 %, exonéré) ont été créés. Vérifiez-les et adaptez-les : rien n&apos;est figé dans le code.</p>{link("/admin/catalog/tax-rates", "Gérer la TVA")}</div>,
    5: <div className="space-y-2"><p className="text-sm text-muted">Renseignez vos horaires d&apos;ouverture dans les paramètres.</p>{link("/admin/settings", "Paramètres → Horaires")}</div>,
    6: <div className="space-y-2"><p className="text-sm text-muted">Créez vos salles (salle, terrasse, bar…).</p>{link("/admin/floor", "Plan de salle")}</div>,
    7: <div className="space-y-2"><p className="text-sm text-muted">Ajoutez vos tables, positionnez-les et indiquez le nombre de places.</p>{link("/admin/floor", "Plan de salle")}</div>,
    8: <div className="flex flex-wrap gap-2">{link("/admin/catalog/products", "Créer le menu")}{link("/admin/catalog/import", "Importer un CSV")}</div>,
    9: <div className="space-y-2"><p className="text-sm text-muted">Créez vos serveurs, managers, cuisine… avec un PIN pour la caisse.</p>{link("/admin/users", "Utilisateurs")}</div>,
    10: <div className="space-y-2"><p className="text-sm text-muted">Les tickets s&apos;impriment depuis le navigateur (HTML/PDF). Le branchement d&apos;imprimantes thermiques réseau est prévu en Phase 7. Configurez les postes de destination des produits.</p>{link("/admin/settings", "Paramètres → Postes")}</div>,
    11: <div className="space-y-2"><p className="text-sm text-muted">Postes cuisine (CUISINE, BAR, PIZZA…) et seuils d&apos;alerte. L&apos;écran cuisine (/kds) affiche les tickets par poste avec les alertes de temps ; les tickets sont générés à chaque envoi.</p>{link("/admin/settings", "Paramètres → Postes cuisine")}</div>,
    12: <div className="space-y-2"><p className="text-sm text-muted">Espèces, carte, chèque, virement, ticket restaurant, offert et autre sont disponibles. Activez les pourboires si besoin.</p>{link("/admin/settings", "Paramètres → Caisse")}</div>,
    13: <div className="space-y-2"><p className="text-sm text-muted">Ouvrez la caisse, créez une commande sur une table, envoyez-la en cuisine et encaissez-la.</p>{link("/pos", "Ouvrir la caisse")}</div>,
    14: <p className="text-sm text-muted">Tout est prêt. Vous pourrez revenir sur chaque réglage depuis l&apos;administration.</p>,
  };
  const bodyFor = (i: number): Record<string, unknown> => (i === 1 ? { name: f.name } : i === 2 ? { addressLine1: f.addressLine1 || null, city: f.city || null, postalCode: f.postalCode || null, phone: f.phone || null } : i === 3 ? { tahitiNumber: f.tahitiNumber || null } : {});

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-8">
      <div className="mb-6 flex items-center justify-between"><Logo /><button onClick={finish} className="text-sm text-muted hover:underline">Passer l&apos;assistant</button></div>
      <ol className="mb-6 grid grid-cols-5 gap-1 sm:grid-cols-8 lg:grid-cols-15">{STEPS.map((l, i) => <li key={l} className={`flex h-8 items-center justify-center rounded-lg text-xs font-bold ${i < step ? "bg-lagon-600 text-white" : i === step ? "bg-corail-500 text-white" : "surface-2 text-muted"}`} title={l}>{i < step ? <Check className="h-4 w-4" /> : i + 1}</li>)}</ol>
      <div className="surface rounded-2xl border p-6">
        <p className="text-xs font-bold uppercase tracking-wide text-muted">Étape {step + 1} / {STEPS.length}</p>
        <h1 className="mb-4 text-2xl font-extrabold">{STEPS[step]}</h1>
        {content[step]}
        <div className="mt-6 flex justify-between">
          <Button variant="ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>Précédent</Button>
          {step < STEPS.length - 1 ? <Button onClick={() => patch(bodyFor(step))}>Continuer</Button> : <Button variant="accent" size="lg" onClick={finish}>Mettre en production</Button>}
        </div>
      </div>
    </main>
  );
}
