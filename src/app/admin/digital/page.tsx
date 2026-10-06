"use client";
/* eslint-disable @next/next/no-img-element -- photos du catalogue (URL libre) et QR codes générés : non optimisables par next/image */

import { useState } from "react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Toggle, Textarea } from "@/components/ui/field";
import { Spinner, Card } from "@/components/ui/misc";
import { PageHeader, useAction, useList } from "@/components/admin/common";
import type { DigitalSettings, SiteSettings } from "@/server/services/public";
import type { LoyaltySettings } from "@/server/services/customers";
import { ExternalLink, Copy } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/hooks/use-session";
import { ShareSite } from "@/components/admin/share-site";
import { PhotoField, PhotoGallery } from "@/components/photo-field";

type S = DigitalSettings & { loyalty: LoyaltySettings; site: SiteSettings; shareSlug: string; urls: { shop: string; reserve: string; kiosk: string; site: string; share: string; shareCard: string } };
type QrRow = { id: string; name: string; url: string; qrToken: string; room: { name: string } };

/** Canaux clients : QR à table, commande en ligne, borne, fidélité ; QR codes à imprimer. */
export default function DigitalPage() {
  const q = useList<S>(["digital"], "/api/digital/settings");
  if (q.isLoading || !q.data) return <div className="flex justify-center py-10"><Spinner /></div>;
  // Le formulaire reste monté quand les données sont rechargées (nouvelle adresse de partage…) : les réglages en cours
  // de saisie ne sont pas perdus ; seules les adresses affichées suivent les données à jour
  return <DigitalForm data={q.data} />;
}

function DigitalForm({ data }: { data: S }) {
  const act = useAction();
  const { me } = useSession();
  const [s, setS] = useState<S>(data);
  const [zones, setZones] = useState(data.online.deliveryZones.join(", "));
  const [photos, setPhotos] = useState<string[]>(data.site.photos);
  // Restaurant exemple (partagé par tous les visiteurs) : le site public ne se modifie pas
  const siteLocked = !!me?.demoLocked;
  const site = (patch: Partial<SiteSettings>) => setS({ ...s, site: { ...s.site, ...patch } });
  // Photos du site : enregistrées dès l'envoi (ou le retrait), sans attendre « Enregistrer » ; une adresse tapée à la
  // main attend l'enregistrement du formulaire
  const { toast: notify } = useToast();
  const savePhotos = (patch: Partial<SiteSettings>) => {
    if (siteLocked) return;
    api.patch("/api/digital/settings", { site: patch }).catch((e) => notify(e instanceof Error ? e.message : "Enregistrement des photos impossible", "error"));
  };
  const setImage = (key: "coverUrl" | "logoUrl", url: string) => { site({ [key]: url }); if (url === "" || url.startsWith("/api/uploads/")) savePhotos({ [key]: url }); };
  const setGallery = (urls: string[]) => { setPhotos(urls); savePhotos({ photos: urls }); };
  const qr = useList<QrRow[]>(["tables", "qr"], "/api/tables/qr");
  const regenerate = (t: QrRow) => confirm(`Créer un nouveau QR code pour la table ${t.name} ? L'ancien cessera aussitôt de fonctionner : il faudra imprimer le nouveau.`) && act(() => api.post(`/api/tables/${t.id}/qr`), { success: `Nouveau QR code pour la table ${t.name} : pensez à l'imprimer`, invalidate: [["tables", "qr"]] });
  const save = () => act(() => api.patch("/api/digital/settings", { qrMode: s.qrMode, online: { ...s.online, deliveryZones: zones.split(",").map((z) => z.trim()).filter(Boolean) }, kiosk: s.kiosk, loyalty: s.loyalty, ...(siteLocked ? {} : { site: { ...s.site, photos } }) }), { success: "Réglages enregistrés", invalidate: [["digital"]] });
  return (
    <div>
      <PageHeader title="Digital" subtitle="Site du restaurant, QR codes à table, commande en ligne, borne et fidélité" action={<Button onClick={save}>Enregistrer</Button>} />
      <ShareSite name={me?.establishment?.name ?? ""} slug={data.shareSlug} url={data.urls.share} card={data.urls.shareCard} enabled={data.site.enabled} locked={siteLocked} />
      <Card title="Site du restaurant (page publique, menu en ligne)" className="mb-4" action={<a href={data.urls.share} target="_blank" rel="noopener" className="text-xs font-bold text-lagon-600">Voir le site ↗</a>}>
        {siteLocked ? <p className="mb-3 rounded-xl bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-800 dark:text-amber-200" data-testid="site-demo-locked">Restaurant exemple : le site se visite mais ne se modifie pas. Créez votre compte pour personnaliser le vôtre.</p> : null}
        <fieldset disabled={siteLocked} className="grid min-w-0 gap-3 disabled:opacity-60 lg:grid-cols-2">
          <div className="min-w-0 space-y-3">
            <Toggle checked={s.site.enabled} onChange={(v) => site({ enabled: v })} label="Publier le site du restaurant" />
            <Field label="Accroche (une phrase)"><Input value={s.site.tagline} onChange={(e) => site({ tagline: e.target.value })} placeholder="Cuisine du lagon, les pieds dans le sable" maxLength={120} /></Field>
            <Field label="Présentation" hint="Votre histoire, votre cuisine, ce qui vous rend unique."><Textarea rows={5} value={s.site.description} onChange={(e) => site({ description: e.target.value })} maxLength={2000} /></Field>
            <div className="flex flex-wrap gap-4"><Toggle checked={s.site.showMenu} onChange={(v) => site({ showMenu: v })} label="Afficher la carte" /><Toggle checked={s.site.showPrices} onChange={(v) => site({ showPrices: v })} label="Afficher les prix" /></div>
            <Field label="Couleur du site"><div className="flex items-center gap-2"><input type="color" value={s.site.accent} onChange={(e) => site({ accent: e.target.value })} className="h-10 w-14 cursor-pointer rounded-lg border border-[var(--border)] bg-transparent" aria-label="Couleur du site" /><code className="text-xs">{s.site.accent}</code></div></Field>
          </div>
          <div className="min-w-0 space-y-3">
            {/* Photos envoyées depuis le téléphone ou l'ordinateur (réduites automatiquement), lien web en option */}
            <PhotoField value={s.site.coverUrl} onChange={(url) => setImage("coverUrl", url)} label="Photo principale (couverture)" shape="wide" maxSide={1920} testId="site-cover" hint="La grande photo derrière le nom du restaurant, en haut du site et dans les partages WhatsApp ou Facebook. Choisissez votre plus belle vue : la salle, la terrasse ou un plat signature, bien éclairée, prise à l'horizontale. Gardez l'essentiel au centre : sur téléphone, les côtés sont coupés." />
            <PhotoField value={s.site.logoUrl} onChange={(url) => setImage("logoUrl", url)} label="Logo" shape="logo" maxSide={600} testId="site-logo" hint="Votre logo, de préférence sur fond transparent (PNG)." />
            <PhotoGallery value={photos} onChange={setGallery} max={12} maxSide={1600} label="Photos du restaurant" />
            <p className="text-xs text-muted">Les photos envoyées apparaissent tout de suite sur votre site.</p>
            <div className="grid gap-3 sm:grid-cols-2"><Field label="Page Facebook"><Input value={s.site.facebook} onChange={(e) => site({ facebook: e.target.value })} placeholder="https://facebook.com/…" inputMode="url" /></Field><Field label="Instagram"><Input value={s.site.instagram} onChange={(e) => site({ instagram: e.target.value })} placeholder="https://instagram.com/…" inputMode="url" /></Field></div>
            <div className="rounded-xl surface-2 p-3 text-xs"><p className="font-bold">Adresse du site</p><LinkRow url={data.urls.share} /><p className="mt-1 text-muted">Le nom, l&apos;adresse, le téléphone et les horaires viennent de Paramètres → Établissement. Les boutons Commander et Réserver apparaissent selon les réglages ci-dessous.</p></div>
          </div>
        </fieldset>
      </Card>
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
            <div className="rounded-xl surface-2 p-3 text-xs"><p className="font-bold">Adresse de la boutique</p><LinkRow url={s.urls.shop} /><p className="mt-1 font-bold">Réservation en ligne</p><LinkRow url={s.urls.reserve} /></div>
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
          {qr.data?.map((t) => <div key={t.id} className="rounded-xl border border-line p-2 text-center"><img src={`/api/tables/${t.id}/qr?size=256&v=${t.qrToken.slice(0, 8)}`} alt={`QR table ${t.name}`} className="mx-auto h-32 w-32" /><p className="mt-1 text-sm font-extrabold">Table {t.name}</p><p className="text-[10px] text-muted">{t.room.name}</p><span className="no-print flex items-center justify-center gap-2"><a href={t.url} target="_blank" rel="noreferrer" className="text-[10px] text-lagon-600">tester</a><button type="button" className="text-[10px] font-semibold text-muted underline-offset-2 hover:underline" onClick={() => regenerate(t)}>nouveau QR</button></span></div>)}
        </div>
        <Button variant="secondary" className="mt-3 no-print" onClick={() => window.print()}>Imprimer les QR codes</Button>
      </Card>
    </div>
  );
}

/** Adresse publique : un clic l'ouvre dans un nouvel onglet ; boutons « Ouvrir » et « Copier ». */
function LinkRow({ url }: { url: string }) {
  const { toast } = useToast();
  const copy = () => navigator.clipboard?.writeText(url).then(() => toast("Adresse copiée", "success"), () => toast("Copie impossible : sélectionnez l'adresse", "error"));
  return (
    <p className="mt-0.5 flex items-center gap-2">
      <a href={url} target="_blank" rel="noopener" className="min-w-0 flex-1 truncate font-mono text-[var(--text)] underline-offset-2 hover:text-lagon-600 hover:underline" title="Ouvrir dans un nouvel onglet">{url}</a>
      <a href={url} target="_blank" rel="noopener" className="touch inline-flex shrink-0 items-center gap-1 rounded-lg bg-lagon-500/12 px-2.5 py-1.5 font-semibold text-lagon-700 transition hover:bg-lagon-500/20 dark:text-lagon-300"><ExternalLink className="h-3.5 w-3.5" />Ouvrir</a>
      <button type="button" onClick={copy} className="touch inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 font-semibold text-lagon-600 transition hover:bg-lagon-500/10"><Copy className="h-3.5 w-3.5" />Copier</button>
    </p>
  );
}
