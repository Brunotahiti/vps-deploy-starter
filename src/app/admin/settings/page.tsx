"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Toggle } from "@/components/ui/field";
import { Spinner, Card, Badge } from "@/components/ui/misc";
import { PageHeader, useAction, useList } from "@/components/admin/common";
import { SubscriptionCard } from "@/components/admin/subscription";
import { ServiceSettingsCard } from "@/components/admin/service-settings";
import { PAYMENT_LABEL } from "@/components/pos/types";
import type { Establishment, PaymentMethodConfig, Terminal, KitchenStation } from "@/generated/prisma/client";
import { BUSINESS_TYPES, type BusinessType } from "@/lib/options";

type Est = Establishment & { paymentMethods: PaymentMethodConfig[]; terminals: Terminal[] };
const DAYS: [string, string][] = [["mon", "Lundi"], ["tue", "Mardi"], ["wed", "Mercredi"], ["thu", "Jeudi"], ["fri", "Vendredi"], ["sat", "Samedi"], ["sun", "Dimanche"]];

export default function SettingsPage() {
  const { me } = useSession();
  const id = me?.establishment?.id;
  const est = useList<Est>(["establishment", id ?? ""], `/api/establishments/${id}`, !!id);
  if (est.isLoading || !est.data) return <div className="flex justify-center py-10"><Spinner /></div>;
  return <SettingsForm key={String(est.data.updatedAt)} initial={est.data} />;
}

function SettingsForm({ initial }: { initial: Est }) {
  const { me } = useSession();
  const qc = useQueryClient();
  const act = useAction();
  const id = initial.id;
  const est = { data: initial };
  const stations = useList<KitchenStation[]>(["stations"], "/api/kitchen-stations");
  const e = initial;
  const initSettings = (e.settings ?? {}) as { courses?: string[]; markTablesToClean?: boolean; payAtOrder?: boolean };
  const initHours = (e.openingHours ?? {}) as Record<string, string[]>;
  const [f, setF] = useState<Record<string, string>>({ businessType: (e as { businessType?: string }).businessType ?? "restaurant", name: e.name, legalName: e.legalName ?? "", tahitiNumber: e.tahitiNumber ?? "", addressLine1: e.addressLine1 ?? "", city: e.city ?? "", postalCode: e.postalCode ?? "", island: e.island ?? "", phone: e.phone ?? "", email: e.email ?? "", currency: e.currency, timezone: e.timezone });
  const [courses, setCourses] = useState((initSettings.courses ?? ["APÉRITIFS", "ENTRÉES", "PLATS", "DESSERTS"]).join(", "));
  const [toClean, setToClean] = useState(!!initSettings.markTablesToClean);
  const [payAtOrder, setPayAtOrder] = useState(initSettings.payAtOrder === true);
  const [hours, setHours] = useState<Record<string, string>>(Object.fromEntries(DAYS.map(([k]) => [k, (initHours[k] ?? []).join(", ")])));
  const [term, setTerm] = useState({ name: "", kind: "POS" });
  const [station, setStation] = useState({ name: "", warn: "600", alert: "900" });

  const save = async () => {
    const body = { ...f, legalName: f.legalName || null, tahitiNumber: f.tahitiNumber || null, addressLine1: f.addressLine1 || null, city: f.city || null, postalCode: f.postalCode || null, island: f.island || null, phone: f.phone || null, email: f.email || null, settings: { ...((est.data?.settings as object) ?? {}), courses: courses.split(",").map((s) => s.trim()).filter(Boolean), markTablesToClean: toClean, payAtOrder }, openingHours: Object.fromEntries(DAYS.map(([k]) => [k, (hours[k] ?? "").split(",").map((s) => s.trim()).filter(Boolean)])) };
    await act(() => api.patch(`/api/establishments/${id}`, body), { success: "Paramètres enregistrés", invalidate: [["establishment"], ["me"], ["pos-catalog"]] });
  };
  const s = (k: string) => ({ value: f[k] ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value }) });

  return (
    <div className="space-y-4">
      <PageHeader title="Paramètres" subtitle={est.data.name} action={<Button onClick={save}>Enregistrer</Button>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Établissement">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Type d'activité" className="sm:col-span-2" hint={BUSINESS_TYPES[(f.businessType ?? "restaurant") as BusinessType]?.hint}><Select {...s("businessType")}>{(Object.keys(BUSINESS_TYPES) as BusinessType[]).map((k) => <option key={k} value={k}>{BUSINESS_TYPES[k].label}</option>)}</Select></Field>
            <Field label="Nom commercial"><Input {...s("name")} /></Field><Field label="Raison sociale"><Input {...s("legalName")} /></Field>
            <Field label="N° Tahiti"><Input {...s("tahitiNumber")} placeholder="A12345" /></Field><Field label="Téléphone"><Input {...s("phone")} /></Field>
            <Field label="Adresse" className="sm:col-span-2"><Input {...s("addressLine1")} /></Field>
            <Field label="Code postal"><Input {...s("postalCode")} /></Field><Field label="Commune"><Input {...s("city")} /></Field>
            <Field label="Île"><Input {...s("island")} placeholder="Tahiti, Moorea…" /></Field><Field label="Email"><Input {...s("email")} /></Field>
            <Field label="Devise" hint="XPF = F CFP, sans décimales"><Select {...s("currency")}><option value="XPF">XPF — F CFP</option><option value="EUR">EUR — €</option><option value="USD">USD — $</option><option value="NZD">NZD</option></Select></Field>
            <Field label="Fuseau horaire"><Select {...s("timezone")}><option value="Pacific/Tahiti">Pacific/Tahiti (Tahiti, Moorea, Tuamotu)</option><option value="Pacific/Marquesas">Pacific/Marquesas</option><option value="Pacific/Gambier">Pacific/Gambier</option><option value="Europe/Paris">Europe/Paris</option></Select></Field>
          </div>
        </Card>
        <Card title="Caisse">
          <div className="space-y-3">
            <Field label="Services (étapes de commande)" hint="ordre d'envoi en cuisine, séparés par des virgules"><Input value={courses} onChange={(e) => setCourses(e.target.value)} /></Field>
            <Toggle checked={toClean} onChange={setToClean} label="Passer la table « à nettoyer » après paiement (sinon libre immédiatement)" />
            <div className="rounded-2xl border border-line p-3">
              <Toggle checked={payAtOrder} onChange={setPayAtOrder} label="Mode roulotte : tout se passe à la caisse" />
              <p className="mt-1.5 text-xs text-muted">Le client choisit sur l&apos;écran, on encaisse tout de suite, la commande part en cuisine. L&apos;accueil de la caisse devient l&apos;écran Comptoir (un seul bouton « Encaisser et envoyer en cuisine »), les commandes payées suivent leur cours sur l&apos;écran « À emporter » (prête → remise) et la cuisine prévient quand c&apos;est prêt. Activé d&apos;office pour un snack ou une roulotte à la création du compte.</p>
            </div>
          </div>
        </Card>
        <SubscriptionCard />
        <ServiceSettingsCard />
        <Card title="Horaires d'ouverture">
          <div className="grid gap-2 sm:grid-cols-2">{DAYS.map(([k, l]) => <Field key={k} label={l}><Input value={hours[k] ?? ""} onChange={(e) => setHours({ ...hours, [k]: e.target.value })} placeholder="11:00-14:30, 18:00-22:00" /></Field>)}</div>
        </Card>
        <Card title="Moyens de paiement">
          <p className="mb-2 text-xs text-muted">Le paiement électronique passe par une couche d&apos;abstraction : les prestataires bancaires disponibles en Polynésie seront branchés en Phase 7. Aucune donnée de carte n&apos;est stockée.</p>
          {est.data.paymentMethods.map((m) => <div key={m.id} className="flex items-center justify-between border-b border-line py-2 text-sm last:border-0"><span>{m.label || PAYMENT_LABEL[m.method]}{m.opensDrawer ? <Badge color="gray">tiroir</Badge> : null}</span><Badge color={m.isEnabled ? "green" : "gray"}>{m.isEnabled ? "activé" : "désactivé"}</Badge></div>)}
        </Card>
        <Card title="Postes cuisine / imprimantes de destination">
          {stations.data?.map((st) => <div key={st.id} className="flex items-center justify-between border-b border-line py-2 text-sm last:border-0"><span><span className="mr-2 inline-block h-3 w-3 rounded-full" style={{ background: st.color }} />{st.name}</span><span className="text-xs text-muted">alerte à {Math.round(st.warnAfterSec / 60)} / {Math.round(st.alertAfterSec / 60)} min</span></div>)}
          <div className="mt-3 flex flex-wrap items-end gap-2"><Field label="Nouveau poste"><Input value={station.name} onChange={(e) => setStation({ ...station, name: e.target.value })} placeholder="PIZZA, GRILL, PASSE…" /></Field><Field label="Avertir (s)"><Input type="number" value={station.warn} onChange={(e) => setStation({ ...station, warn: e.target.value })} className="w-24" /></Field><Field label="Alerte (s)"><Input type="number" value={station.alert} onChange={(e) => setStation({ ...station, alert: e.target.value })} className="w-24" /></Field><Button variant="secondary" disabled={!station.name} onClick={async () => { const r = await act(() => api.post("/api/kitchen-stations", { name: station.name.toUpperCase(), warnAfterSec: Number(station.warn), alertAfterSec: Number(station.alert) }), { success: "Poste créé", invalidate: [["stations"], ["pos-catalog"]] }); if (r) setStation({ name: "", warn: "600", alert: "900" }); }}>Ajouter</Button></div>
          <p className="mt-2 text-xs text-muted">Impression : tickets HTML (navigateur), PDF et flux ESC/POS générés côté serveur. Le transport vers une imprimante réseau/USB est prévu en Phase 7 via HardwareAdapter.</p>
        </Card>
        <Card title="Reçus par e-mail">
          <p className="text-sm">{me?.features?.email ? <Badge color="green">activé</Badge> : <Badge color="orange">non configuré</Badge>} <span className="ml-2 text-muted">Envoi du reçu PDF au client depuis la caisse (après paiement ou bouton Ticket) et depuis l&apos;historique des commandes.</span></p>
          {!me?.features?.email ? <p className="mt-2 text-xs text-muted">Pour l&apos;activer, renseignez sur le serveur les variables <code>SMTP_HOST</code>, <code>SMTP_PORT</code>, <code>SMTP_USER</code>, <code>SMTP_PASS</code>, <code>SMTP_FROM</code> (fichier <code>.env</code>, exemple Hostinger : smtp.hostinger.com, port 465), puis redémarrez l&apos;application.</p> : null}
        </Card>
        <Card title="Terminaux (appareils de caisse)">
          <p className="mb-2 text-xs text-muted">Enregistrer <strong>cet appareil</strong> permet au personnel de se connecter par PIN sur l&apos;écran /pos/login, sans email.</p>
          {est.data.terminals.map((t) => <div key={t.id} className="flex items-center justify-between border-b border-line py-2 text-sm last:border-0"><span>{t.name} <Badge color="gray">{t.kind}</Badge>{me?.terminal?.id === t.id ? <Badge color="teal">cet appareil</Badge> : null}</span><span className="text-xs text-muted">{t.lastSeenAt ? new Date(t.lastSeenAt).toLocaleString("fr-FR") : ""}</span></div>)}
          <div className="mt-3 flex flex-wrap items-end gap-2"><Field label="Nom de l'appareil"><Input value={term.name} onChange={(e) => setTerm({ ...term, name: e.target.value })} placeholder="Caisse bar, iPad terrasse…" /></Field><Field label="Type"><Select value={term.kind} onChange={(e) => setTerm({ ...term, kind: e.target.value })}><option value="POS">Caisse</option><option value="KDS">Écran cuisine</option><option value="KIOSK">Borne</option><option value="MANAGER">Manager</option></Select></Field><Button variant="secondary" disabled={!term.name} onClick={async () => { const r = await act(() => api.post("/api/auth/terminal/register", term), { success: "Appareil enregistré", invalidate: [["establishment"], ["me"]] }); if (r) { setTerm({ name: "", kind: "POS" }); qc.invalidateQueries(); } }}>Enregistrer cet appareil</Button>{me?.terminal ? <Button variant="ghost" onClick={() => act(() => api.post("/api/auth/terminal/unregister"), { success: "Appareil retiré", invalidate: [["establishment"], ["me"]] })}>Retirer cet appareil</Button> : null}</div>
        </Card>
      </div>
    </div>
  );
}
