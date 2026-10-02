"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, HardDrive, Plus, Trash2, Wifi, WifiOff } from "lucide-react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { useAction } from "@/components/admin/common";
import type { listBoxes } from "@/server/box/boxes";

type Box = Awaited<ReturnType<typeof listBoxes>>[number];
const BOX_OFFLINE_MS = 5 * 60_000;

function ago(date: string | Date, now: number) {
  const s = Math.max(0, Math.round((now - new Date(date).getTime()) / 1000));
  if (s < 60) return `il y a ${s} s`;
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  return `il y a ${Math.round(s / 86400)} j`;
}

/** Ligne à copier (clé, commande) */
function CopyLine({ value, testId, label }: { value: string; testId: string; label: string }) {
  const { toast } = useToast();
  return (
    <div className="flex items-stretch gap-2">
      <code className="min-w-0 flex-1 break-all rounded-xl surface-2 px-3 py-2.5 text-xs" data-testid={testId}>{value}</code>
      <Button variant="secondary" onClick={() => navigator.clipboard?.writeText(value).then(() => toast(label, "success"), () => toast("Copie impossible : sélectionnez le texte", "error"))}><Copy className="h-4 w-4" />Copier</Button>
    </div>
  );
}

/** Boîtier de secours : mini-PC du restaurant qui garde une copie à jour et prend le relais quand internet coupe. */
export function LocalBoxes({ now }: { now: number }) {
  const act = useAction();
  const q = useQuery({ queryKey: ["boxes"], queryFn: () => api.get<Box[]>("/api/boxes"), refetchInterval: 30_000 });
  const [name, setName] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; key: string } | null>(null);
  const boxes = q.data ?? [];
  const installCommand = `curl -fsSL ${typeof window === "undefined" ? "" : window.location.origin}/box/install.sh -o install.sh && sudo sh install.sh`;

  const create = async () => {
    const r = await act(() => api.post<Box & { key: string }>("/api/boxes", { name }), { invalidate: [["boxes"]] });
    if (!r) return;
    setName(null);
    setCreated({ name: r.name, key: r.key });
  };

  return (
    <section className="mt-8" data-testid="local-boxes">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-extrabold"><HardDrive className="h-5 w-5 text-lagon-600" />Boîtier de secours</h2>
          <p className="max-w-2xl text-sm text-muted">Un petit ordinateur branché sur la box du restaurant garde une copie à jour de votre restaurant. Quand internet coupe, les tablettes continuent de travailler avec lui (commandes, cuisine, encaissements, impression) ; tout repart vers ManaResto au retour de la connexion.</p>
        </div>
        <Button variant="secondary" onClick={() => setName("Boîtier de la caisse")}><Plus className="h-4 w-4" />Ajouter un boîtier</Button>
      </div>
      {boxes.length === 0 ? (
        <div className="card p-5 text-sm text-muted">Aucun boîtier : sans internet, chaque tablette continue seule avec ce qu&apos;elle a déjà en mémoire.</div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {boxes.map((b) => {
            const online = b.lastSeenAt && now && now - new Date(b.lastSeenAt).getTime() < BOX_OFFLINE_MS;
            return (
              <article key={b.id} className="card flex items-start gap-3 p-4" data-testid="box-card">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-500 to-slate-700 text-white"><HardDrive className="h-5 w-5" /></span>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-base font-extrabold">{b.name}</h3>
                  <p className="mt-1 text-xs font-semibold">
                    {!b.lastSeenAt ? <span className="inline-flex items-center gap-1 text-orange-600"><WifiOff className="h-3.5 w-3.5" />Pas encore installé</span>
                      : online ? <span className="inline-flex items-center gap-1 text-green-600"><Wifi className="h-3.5 w-3.5" />Copie à jour · {ago(b.lastSeenAt, now)}</span>
                      : <span className="inline-flex items-center gap-1 text-red-600"><WifiOff className="h-3.5 w-3.5" />Injoignable · vu {ago(b.lastSeenAt, now)}</span>}
                  </p>
                  {b.hostname && b.lanIp ? <p className="mt-1 text-xs">Sur les tablettes : <a href={`https://${b.hostname}`} target="_blank" rel="noreferrer" className="font-bold text-lagon-700 hover:underline dark:text-lagon-300" data-testid="box-hostname">https://{b.hostname}</a></p> : null}
                  {b.lanIp || b.version ? <p className="mt-0.5 text-xs text-muted">{b.lanIp ? `Adresse locale ${b.lanIp}` : ""}{b.lanIp && b.version ? " · " : ""}{b.version ? `version ${b.version}` : ""}</p> : null}
                </div>
                <Button size="sm" variant="ghost" className="text-red-600" onClick={() => confirm(`Retirer « ${b.name} » ? Sa clé cessera aussitôt de fonctionner.`) && act(() => api.delete(`/api/boxes/${b.id}`), { success: "Boîtier retiré", invalidate: [["boxes"]] })}><Trash2 className="h-4 w-4" />Retirer</Button>
              </article>
            );
          })}
        </div>
      )}

      <Modal open={name !== null} onClose={() => setName(null)} title="Ajouter un boîtier de secours" size="md" footer={<Button className="w-full" disabled={!name?.trim()} onClick={create}>Créer la clé du boîtier</Button>}>
        <div className="space-y-3 text-sm">
          <Field label="Nom"><Input value={name ?? ""} onChange={(e) => setName(e.target.value)} /></Field>
          <p className="text-muted">ManaResto crée une clé qui permet au boîtier de télécharger la copie de ce restaurant, et seulement de celui-ci.</p>
        </div>
      </Modal>

      <Modal open={!!created} onClose={() => setCreated(null)} title={`Clé de « ${created?.name ?? ""} »`} size="md" footer={<Button className="w-full" onClick={() => setCreated(null)}>J&apos;ai copié la clé</Button>}>
        {created ? (
          <div className="space-y-4 text-sm">
            <p>Saisissez cette clé lors de l&apos;installation du boîtier. <strong>Elle n&apos;est affichée qu&apos;une fois</strong> : en cas de perte, retirez le boîtier et créez-en un nouveau.</p>
            <CopyLine value={created.key} testId="box-key" label="Clé copiée" />
            <div className="rounded-2xl border border-line p-3">
              <p className="font-bold">Installation sur le mini-PC</p>
              <ol className="mt-1.5 list-decimal space-y-1.5 pl-5 text-muted">
                <li>Un mini-PC Intel ou AMD sous Ubuntu ou Debian, branché par câble sur la box du restaurant, toujours allumé.</li>
                <li>Dans son terminal, lancez la commande ci-dessous, puis collez la clé quand elle est demandée :</li>
              </ol>
              <div className="mt-2"><CopyLine value={installCommand} testId="box-install" label="Commande copiée" /></div>
              <p className="mt-2 text-xs text-muted">À la fin, le boîtier affiche l&apos;adresse à ouvrir sur chaque tablette (elle apparaît aussi ici). Les tablettes s&apos;installent depuis cette adresse.</p>
            </div>
          </div>
        ) : null}
      </Modal>
    </section>
  );
}
