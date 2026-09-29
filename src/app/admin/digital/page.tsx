"use client";
/* eslint-disable @next/next/no-img-element -- photos du catalogue (URL libre) et QR codes générés : non optimisables par next/image */

import { useState } from "react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Toggle, Textarea } from "@/components/ui/field";
import { Spinner, Card } from "@/components/ui/misc";
import { PageHeader, useAction, useList } from "@/components/admin/common";
import type { DigitalSettings } from "@/server/services/public";
import type { LoyaltySettings } from "@/server/services/customers";

type S = DigitalSettings & { loyalty: LoyaltySettings; urls: { shop: string; reserve: string; kiosk: string } };
type QrRow = { id: string; name: string; url: string; room: { name: string } };

/** Canaux clients : QR à table, commande en ligne, borne, fidélité ; QR codes à imprimer. */
export default function DigitalPage() {
  const q = useList<S>(["digital"], "/api/digital/settings");
  if (q.isLoading || !q.data) return <div className="flex justify-center py-10"><Spinner /></div>;
  return <DigitalForm key={JSON.stringify(q.data)} initial={q.data} />;
}

function DigitalForm({ initial }: { initial: S }) {
  const act = useAction();
  const [s, setS] = useState<S>(initial);
  const [zones, setZones] = useState(initial.online.deliveryZones.join(", "));
  const qr = useList<QrRow[]>(["tables", "qr"], "/api/tables/qr");
  const save = () => act(() => api.patch("/api/digital/settings", { qrMode: s.qrMode, online: { ...s.online, deliveryZones: zones.split(",").map((z) => z.trim()).filter(Boolean) }, kiosk: s.kiosk, loyalty: s.loyalty }), { success: "Réglages enregistrés", invalidate: [["digital"]] });
  const copy = (v: string) => navigator.clipboard?.writeText(v);
  return (
    <div>
      <PageHeader title="Digital" subtitle="QR codes à table, commande en ligne, borne et fidélité" action={<Button onClick={save}>Enregistrer</Button>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="QR code à table">
          <Field label="Mode"><Select value={s.qrMode} onChange={(e) => setS({ ...s, qrMode: e.target.value as DigitalSettings["qrMode"] })}>
            <option value="MENU">1 · Menu seul (consultation)</option><option value="MENU_CALL">2 · Menu + appel serveur</option><option value="ORDER">3 · Commande à table validée par le personnel</option><option value="ORDER_DIRECT">4 · Commande à table envoyée directement en cuisine</option>
          </Select></Field>
          <p className="mt-2 text-xs text-muted">En mode 3, les commandes des clients apparaissent dans Commandes → En ligne et sur la table ; le serveur les envoie en cuisine après vérification. En mode 4, elles partent directement en cuisine.</p>
          <div className="mt-3 flex items-center justify-between"><p className="text-sm font-semibold">QR codes des tables</p><a href="#qr" className="text-xs font-semibold text-lagon-600">Voir ci-dessous</a></div>
        </Card>
        <Card title="Commande en ligne (click & collect, livraison)">
          <div className="space-y-3">
            <Toggle checked={s.online.enabled} onChange={(v) => setS({ ...s, online: { ...s.online, enabled: v } })} label="Activer la commande en ligne" />
            <div className="flex gap-4"><Toggle checked={s.online.pickup} onChange={(v) => setS({ ...s, online: { ...s.online, pickup: v } })} label="Retrait (click & collect)" /><Toggle checked={s.online.delivery} onChange={(v) => setS({ ...s, online: { ...s.online, delivery: v } })} label="Livraison" /></div>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Délai retrait (min)"><Input type="number" value={s.online.pickupLeadMin} onChange={(e) => setS({ ...s, online: { ...s.online, pickupLeadMin: Number(e.target.value || 0) } })} /></Field>
              <Field label="Frais livraison (F)"><Input type="number" value={s.online.deliveryFee} onChange={(e) => setS({ ...s, online: { ...s.online, deliveryFee: Number(e.target.value || 0) } })} /></Field>
              <Field label="Minimum livraison (F)"><Input type="number" value={s.online.deliveryMinOrder} onChange={(e) => setS({ ...s, online: { ...s.online, deliveryMinOrder: Number(e.target.value || 0) } })} /></Field>
            </div>
            <Field label="Zones de livraison (communes, séparées par des virgules ; vide = partout)"><Input value={zones} onChange={(e) => setZones(e.target.value)} placeholder="Punaauia, Paea, Faa'a" /></Field>
            <Field label="Message affiché aux clients"><Textarea value={s.online.message} onChange={(e) => setS({ ...s, online: { ...s.online, message: e.target.value } })} placeholder="Commandes en ligne de 11 h à 13 h 30 et de 18 h à 21 h." /></Field>
            <div className="rounded-xl surface-2 p-3 text-xs"><p className="font-bold">Adresse de la boutique</p><p className="flex items-center gap-2"><code className="min-w-0 flex-1 truncate">{s.urls.shop}</code><button onClick={() => copy(s.urls.shop)} className="font-semibold text-lagon-600">Copier</button></p><p className="mt-1 font-bold">Réservation en ligne</p><p className="flex items-center gap-2"><code className="min-w-0 flex-1 truncate">{s.urls.reserve}</code><button onClick={() => copy(s.urls.reserve)} className="font-semibold text-lagon-600">Copier</button></p></div>
          </div>
        </Card>
        <Card title="Borne de commande">
          <div className="space-y-3">
            <Toggle checked={s.kiosk.enabled} onChange={(v) => setS({ ...s, kiosk: { ...s.kiosk, enabled: v } })} label="Activer la borne" />
            <div className="flex gap-4"><Toggle checked={s.kiosk.dineIn} onChange={(v) => setS({ ...s, kiosk: { ...s.kiosk, dineIn: v } })} label="Sur place" /><Toggle checked={s.kiosk.takeaway} onChange={(v) => setS({ ...s, kiosk: { ...s.kiosk, takeaway: v } })} label="À emporter" /></div>
            <p className="text-xs text-muted">Sur la tablette borne : connectez-vous en manager, enregistrez l&apos;appareil (Paramètres → Terminaux, type « Borne »), déconnectez-vous puis ouvrez <code>{s.urls.kiosk}</code>. Le client commande, reçoit un numéro et règle en caisse.</p>
          </div>
        </Card>
        <Card title="Programme de fidélité">
          <div className="space-y-3">
            <Toggle checked={s.loyalty.enabled} onChange={(v) => setS({ ...s, loyalty: { ...s.loyalty, enabled: v } })} label="Activer la fidélité" />
            <div className="grid grid-cols-3 gap-2">
              <Field label="Points par 100 F"><Input type="number" value={s.loyalty.pointsPer100} onChange={(e) => setS({ ...s, loyalty: { ...s.loyalty, pointsPer100: Number(e.target.value || 0) } })} /></Field>
              <Field label="Seuil (points)"><Input type="number" value={s.loyalty.rewardPoints} onChange={(e) => setS({ ...s, loyalty: { ...s.loyalty, rewardPoints: Number(e.target.value || 1) } })} /></Field>
              <Field label="Récompense (F)"><Input type="number" value={s.loyalty.rewardValue} onChange={(e) => setS({ ...s, loyalty: { ...s.loyalty, rewardValue: Number(e.target.value || 0) } })} /></Field>
            </div>
            <p className="text-xs text-muted">Les points sont crédités au paiement d&apos;une commande rattachée à un client (bouton « Client » sur la commande). Une récompense s&apos;applique comme remise sur la commande.</p>
          </div>
        </Card>
      </div>
      <Card title="QR codes des tables (à imprimer)" className="mt-4">
        <div id="qr" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 print:grid-cols-4">
          {qr.data?.map((t) => <div key={t.id} className="rounded-xl border border-line p-2 text-center"><img src={`/api/tables/${t.id}/qr?size=256`} alt={`QR table ${t.name}`} className="mx-auto h-32 w-32" /><p className="mt-1 text-sm font-extrabold">Table {t.name}</p><p className="text-[10px] text-muted">{t.room.name}</p><a href={t.url} target="_blank" rel="noreferrer" className="text-[10px] text-lagon-600">tester</a></div>)}
        </div>
        <Button variant="secondary" className="mt-3 no-print" onClick={() => window.print()}>Imprimer les QR codes</Button>
      </Card>
    </div>
  );
}
