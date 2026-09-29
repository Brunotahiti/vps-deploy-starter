"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Select } from "@/components/ui/field";
import { Spinner, Badge, Card } from "@/components/ui/misc";
import { formatDateTime } from "@/lib/dates";
import { PageHeader, Table, Tr, Td, useAction, useList } from "@/components/admin/common";
import type { listApiKeys } from "@/server/api-keys";
import type { listWebhooks } from "@/server/webhooks";
import type { listPrinters } from "@/server/hardware/printers";
import type { KitchenStation } from "@/generated/prisma/client";

type Key = Awaited<ReturnType<typeof listApiKeys>>[number];
type Hook = Awaited<ReturnType<typeof listWebhooks>>[number];
type Printer = Awaited<ReturnType<typeof listPrinters>>[number];
type Tab = "api" | "webhooks" | "printers" | "terminal";

/** Intégrations : API publique, webhooks, imprimantes, terminal de paiement. */
export default function IntegrationsPage() {
  const [tab, setTab] = useState<Tab>("api");
  return (
    <div>
      <PageHeader title="Intégrations" subtitle="API publique, webhooks, imprimantes réseau et terminal de paiement" />
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line">{([["api", "Clés API"], ["webhooks", "Webhooks"], ["printers", "Imprimantes"], ["terminal", "TPE"]] as [Tab, string][]).map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`shrink-0 border-b-2 px-3 py-2 text-sm font-semibold ${tab === k ? "border-lagon-500 text-lagon-600" : "border-transparent text-muted"}`}>{l}</button>)}</div>
      {tab === "api" ? <ApiKeys /> : tab === "webhooks" ? <Webhooks /> : tab === "printers" ? <Printers /> : <Terminal />}
    </div>
  );
}

function ApiKeys() {
  const { timezone } = useSession();
  const act = useAction();
  const q = useList<{ keys: Key[]; scopes: Record<string, string> }>(["integrations", "api-keys"], "/api/integrations/api-keys");
  const [form, setForm] = useState<{ name: string; scopes: string[] } | null>(null);
  const [shown, setShown] = useState<{ key: string; name: string } | null>(null);
  const create = async () => { if (!form) return; const r = await act(() => api.post<{ key: string; name: string }>("/api/integrations/api-keys", form), { success: "Clé créée", invalidate: [["integrations"]] }); if (r) { setShown(r); setForm(null); } };
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2"><p className="text-sm text-muted">Authentification : en-tête <code>Authorization: Bearer mr_live_…</code>. Documentation : <code>docs/API-PUBLIQUE.md</code>.</p><Button onClick={() => setForm({ name: "", scopes: ["orders:read", "catalog:read", "reports:read"] })}>Nouvelle clé</Button></div>
      {q.isLoading ? <Spinner /> : <Table head={["Nom", "Préfixe", "Portées", "Dernier usage", "Statut", ""]}>{q.data?.keys.map((k) => <Tr key={k.id}><Td className="font-semibold">{k.name}</Td><Td className="font-mono text-xs">{k.prefix}…</Td><Td className="text-xs">{k.scopes.join(", ")}</Td><Td className="text-xs">{k.lastUsedAt ? formatDateTime(k.lastUsedAt, timezone) : "jamais"}</Td><Td>{k.isActive ? <Badge color="green">active</Badge> : <Badge color="red">révoquée</Badge>}</Td><Td>{k.isActive ? <button onClick={() => confirm("Révoquer cette clé ? Les intégrations qui l'utilisent cesseront de fonctionner.") && act(() => api.delete(`/api/integrations/api-keys/${k.id}`), { success: "Clé révoquée", invalidate: [["integrations"]] })} className="text-xs font-semibold text-red-600">Révoquer</button> : null}</Td></Tr>)}{q.data?.keys.length === 0 ? <Tr><Td className="py-6 text-center text-muted">Aucune clé</Td></Tr> : null}</Table>}
      <Modal open={!!form} onClose={() => setForm(null)} title="Nouvelle clé API" size="sm" footer={<Button className="w-full" disabled={!form?.name || form.scopes.length === 0} onClick={create}>Créer</Button>}>
        {form ? <div className="space-y-3"><Field label="Nom (usage)"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Comptable, site vitrine, Zapier…" /></Field><div className="space-y-1">{Object.entries(q.data?.scopes ?? {}).map(([k, l]) => <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.scopes.includes(k)} onChange={(e) => setForm({ ...form, scopes: e.target.checked ? [...form.scopes, k] : form.scopes.filter((s) => s !== k) })} /><span><code className="text-xs">{k}</code> — {l}</span></label>)}</div></div> : null}
      </Modal>
      <Modal open={!!shown} onClose={() => setShown(null)} title="Clé créée — copiez-la maintenant" size="sm"><p className="mb-2 text-sm text-muted">Cette clé ne sera plus jamais affichée.</p><code className="block break-all rounded-xl surface-2 p-3 text-sm">{shown?.key}</code><Button className="mt-3 w-full" variant="secondary" onClick={() => navigator.clipboard?.writeText(shown?.key ?? "")}>Copier</Button></Modal>
    </div>
  );
}

function Webhooks() {
  const { timezone } = useSession();
  const act = useAction();
  const q = useList<{ webhooks: Hook[]; events: string[] }>(["integrations", "webhooks"], "/api/integrations/webhooks");
  const [form, setForm] = useState<{ url: string; events: string[]; description: string } | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const create = async () => { if (!form) return; const r = await act(() => api.post<{ secret: string }>("/api/integrations/webhooks", { ...form, description: form.description || null }), { success: "Webhook créé", invalidate: [["integrations"]] }); if (r) { setSecret(r.secret); setForm(null); } };
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2"><p className="text-sm text-muted">POST JSON signé (<code>X-ManaResto-Signature: sha256=HMAC(secret, corps)</code>), 3 tentatives, désactivation après 20 échecs.</p><Button onClick={() => setForm({ url: "", events: ["order.closed"], description: "" })}>Nouveau webhook</Button></div>
      {q.isLoading ? <Spinner /> : <div className="space-y-2">{q.data?.webhooks.map((w) => <Card key={w.id}><div className="flex flex-wrap items-center gap-2"><code className="min-w-0 flex-1 truncate text-sm">{w.url}</code>{w.isActive ? <Badge color="green">actif</Badge> : <Badge color="red">désactivé</Badge>}{w.lastStatus ? <Badge color={w.lastStatus < 300 ? "teal" : "orange"}>dernier : {w.lastStatus}</Badge> : null}{w.failures ? <Badge color="orange">{w.failures} échec{w.failures > 1 ? "s" : ""}</Badge> : null}</div><p className="mt-1 text-xs text-muted">{w.events.join(", ")}{w.description ? ` · ${w.description}` : ""}{w.lastAt ? ` · ${formatDateTime(w.lastAt, timezone)}` : ""}{w.lastError ? <span className="block text-red-600">{w.lastError}</span> : null}</p><div className="mt-2 flex gap-2"><Button size="sm" variant="secondary" onClick={() => act(() => api.post<{ ok: boolean; status: number | null; error: string | null }>(`/api/integrations/webhooks/${w.id}/test`), { invalidate: [["integrations"]] }).then((r) => r && alert(r.ok ? `Test réussi (HTTP ${r.status})` : `Échec : ${r.error ?? r.status}`))}>Tester</Button><Button size="sm" variant="ghost" onClick={() => act(() => api.patch(`/api/integrations/webhooks/${w.id}`, { isActive: !w.isActive }), { invalidate: [["integrations"]] })}>{w.isActive ? "Désactiver" : "Réactiver"}</Button><Button size="sm" variant="ghost" onClick={() => confirm("Supprimer ce webhook ?") && act(() => api.delete(`/api/integrations/webhooks/${w.id}`), { success: "Supprimé", invalidate: [["integrations"]] })}>Supprimer</Button></div>{w.deliveries.length ? <ul className="mt-2 text-[11px] text-muted">{w.deliveries.map((d) => <li key={d.id}>{formatDateTime(d.createdAt, timezone)} · {d.event} · {d.status ?? "—"} · {d.attempts} tentative{d.attempts > 1 ? "s" : ""}{d.error ? ` · ${d.error}` : ""}</li>)}</ul> : null}</Card>)}{q.data?.webhooks.length === 0 ? <p className="py-6 text-center text-sm text-muted">Aucun webhook</p> : null}</div>}
      <Modal open={!!form} onClose={() => setForm(null)} title="Nouveau webhook" size="sm" footer={<Button className="w-full" disabled={!form?.url || form.events.length === 0} onClick={create}>Créer</Button>}>
        {form ? <div className="space-y-3"><Field label="URL (https)"><Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://exemple.pf/manaresto" /></Field><Field label="Description"><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field><div className="space-y-1"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.events.includes("*")} onChange={(e) => setForm({ ...form, events: e.target.checked ? ["*"] : [] })} /><b>Tous les événements</b></label>{q.data?.events.map((ev) => <label key={ev} className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={form.events.includes("*")} checked={form.events.includes(ev) || form.events.includes("*")} onChange={(e) => setForm({ ...form, events: e.target.checked ? [...form.events, ev] : form.events.filter((x) => x !== ev) })} /><code className="text-xs">{ev}</code></label>)}</div></div> : null}
      </Modal>
      <Modal open={!!secret} onClose={() => setSecret(null)} title="Secret du webhook — copiez-le maintenant" size="sm"><p className="mb-2 text-sm text-muted">Sert à vérifier la signature des livraisons. Il ne sera plus affiché.</p><code className="block break-all rounded-xl surface-2 p-3 text-sm">{secret}</code><Button className="mt-3 w-full" variant="secondary" onClick={() => navigator.clipboard?.writeText(secret ?? "")}>Copier</Button></Modal>
    </div>
  );
}

function Printers() {
  const act = useAction();
  const q = useList<Printer[]>(["printers"], "/api/printers");
  const stations = useList<KitchenStation[]>(["stations"], "/api/kitchen-stations");
  const [form, setForm] = useState<{ id?: string; name: string; kind: "RECEIPT" | "KITCHEN"; driver: "escpos-network" | "agent" | "browser"; host: string; port: string; agentUrl: string; paperWidthMm: string; stationId: string } | null>(null);
  const save = async () => { if (!form) return; const body = { name: form.name, kind: form.kind, driver: form.driver, connection: { host: form.host || undefined, port: form.port ? Number(form.port) : undefined, agentUrl: form.agentUrl || undefined }, paperWidthMm: Number(form.paperWidthMm || 80), stationId: form.stationId || null }; const r = await act(() => (form.id ? api.patch(`/api/printers/${form.id}`, body) : api.post("/api/printers", body)), { success: "Imprimante enregistrée", invalidate: [["printers"]] }); if (r) setForm(null); };
  const test = async (p: Printer) => { const r = await act(() => api.post<{ delivered: boolean; error?: string; agentUrl?: string; payloadBase64?: string }>("/api/print", { printerId: p.id, kind: "test" })); if (!r) return; if (r.delivered) alert("Test envoyé à l'imprimante"); else if (r.agentUrl && r.payloadBase64) { try { await fetch(r.agentUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payloadBase64: r.payloadBase64 }) }); alert("Test transmis à l'agent d'impression"); } catch { alert("Agent d'impression injoignable depuis ce navigateur"); } } else alert(r.error ?? "Impression impossible"); };
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2"><p className="text-sm text-muted">Réseau (TCP 9100) quand ManaResto tourne sur place ; sinon un <b>agent d&apos;impression</b> local (<code>tools/print-agent</code>) reçoit les tickets depuis la tablette.</p><Button onClick={() => setForm({ name: "", kind: "RECEIPT", driver: "escpos-network", host: "", port: "9100", agentUrl: "", paperWidthMm: "80", stationId: "" })}>Nouvelle imprimante</Button></div>
      {q.isLoading ? <Spinner /> : <Table head={["Nom", "Type", "Pilote", "Connexion", "Poste", ""]}>{q.data?.map((p) => { const c = p.connection as { host?: string; port?: number; agentUrl?: string }; return <Tr key={p.id}><Td className="font-semibold">{p.name}</Td><Td>{p.kind === "KITCHEN" ? "Cuisine" : "Caisse"}</Td><Td className="text-xs">{p.driver}</Td><Td className="text-xs">{c.host ? `${c.host}:${c.port ?? 9100}` : c.agentUrl ?? "navigateur"}</Td><Td>{p.station?.name ?? "—"}</Td><Td className="space-x-3 whitespace-nowrap"><button onClick={() => test(p)} className="text-xs font-semibold text-lagon-600">Tester</button><button onClick={() => setForm({ id: p.id, name: p.name, kind: p.kind, driver: p.driver as "escpos-network", host: c.host ?? "", port: String(c.port ?? 9100), agentUrl: c.agentUrl ?? "", paperWidthMm: String(p.paperWidthMm), stationId: p.stationId ?? "" })} className="text-xs font-semibold text-lagon-600">Modifier</button><button onClick={() => confirm("Supprimer ?") && act(() => api.delete(`/api/printers/${p.id}`), { success: "Supprimée", invalidate: [["printers"]] })} className="text-xs font-semibold text-red-600">Supprimer</button></Td></Tr>; })}{q.data?.length === 0 ? <Tr><Td className="py-6 text-center text-muted">Aucune imprimante : l&apos;impression passe par le navigateur.</Td></Tr> : null}</Table>}
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? "Modifier l'imprimante" : "Nouvelle imprimante"} size="md" footer={<Button className="w-full" disabled={!form?.name} onClick={save}>Enregistrer</Button>}>
        {form ? <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nom"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Caisse bar, Cuisine chaude…" /></Field>
          <Field label="Type"><Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as "RECEIPT" })}><option value="RECEIPT">Reçus (caisse)</option><option value="KITCHEN">Bons cuisine</option></Select></Field>
          <Field label="Pilote"><Select value={form.driver} onChange={(e) => setForm({ ...form, driver: e.target.value as "agent" })}><option value="escpos-network">Réseau ESC/POS (TCP 9100, serveur sur place)</option><option value="agent">Agent d&apos;impression local (HTTP)</option><option value="browser">Navigateur (HTML)</option></Select></Field>
          <Field label="Largeur papier (mm)"><Input type="number" value={form.paperWidthMm} onChange={(e) => setForm({ ...form, paperWidthMm: e.target.value })} /></Field>
          {form.driver === "escpos-network" ? <><Field label="Adresse IP"><Input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="192.168.1.50" /></Field><Field label="Port"><Input type="number" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} /></Field></> : null}
          {form.driver === "agent" ? <Field label="URL de l'agent" className="sm:col-span-2" hint="Ex. http://192.168.1.20:9123/print — l'agent transmet à l'imprimante"><Input value={form.agentUrl} onChange={(e) => setForm({ ...form, agentUrl: e.target.value })} /></Field> : null}
          {form.kind === "KITCHEN" ? <Field label="Poste cuisine (bons auto-imprimés à l'envoi)"><Select value={form.stationId} onChange={(e) => setForm({ ...form, stationId: e.target.value })}><option value="">Tous les postes</option>{stations.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field> : null}
        </div> : null}
      </Modal>
    </div>
  );
}

function Terminal() {
  const act = useAction();
  const q = useList<{ adapter: "manual" | "bridge"; url?: string; terminalId?: string; timeoutMs?: number; connected: boolean }>(["terminal-settings"], "/api/payments/terminal/settings");
  const [f, setF] = useState<{ adapter: "manual" | "bridge"; url: string; apiKey: string; terminalId: string; timeoutMs: string } | null>(null);
  const s = f ?? (q.data ? { adapter: q.data.adapter, url: q.data.url ?? "", apiKey: "", terminalId: q.data.terminalId ?? "", timeoutMs: String(q.data.timeoutMs ?? 90000) } : null);
  if (!s) return <Spinner />;
  return (
    <Card title="Terminal de paiement (TPE)">
      <div className="space-y-3">
        <p className="text-sm text-muted">Mode <b>manuel</b> : le serveur saisit le montant sur le TPE et note la référence. Mode <b>passerelle</b> : ManaResto envoie le montant à une passerelle HTTP (agent local ou prestataire monétique) qui pilote le terminal et renvoie la référence de transaction ; le bouton « Envoyer au TPE » apparaît dans l&apos;encaissement par carte.</p>
        <Select value={s.adapter} onChange={(e) => setF({ ...s, adapter: e.target.value as "manual" })}><option value="manual">Manuel (TPE autonome)</option><option value="bridge">Passerelle HTTP</option></Select>
        {s.adapter === "bridge" ? <div className="grid gap-3 sm:grid-cols-2"><Field label="URL de la passerelle" hint="POST {url}/charge {amount, currency, reference, terminalId} → {ok, providerRef} ; POST {url}/refund"><Input value={s.url} onChange={(e) => setF({ ...s, url: e.target.value })} placeholder="http://192.168.1.20:9200" /></Field><Field label="Clé (Bearer, facultatif)"><Input value={s.apiKey} onChange={(e) => setF({ ...s, apiKey: e.target.value })} placeholder="inchangée si vide" /></Field><Field label="Identifiant du terminal"><Input value={s.terminalId} onChange={(e) => setF({ ...s, terminalId: e.target.value })} /></Field><Field label="Délai max (ms)"><Input type="number" value={s.timeoutMs} onChange={(e) => setF({ ...s, timeoutMs: e.target.value })} /></Field></div> : null}
        <Button onClick={() => act(() => api.patch("/api/payments/terminal/settings", { adapter: s.adapter, url: s.url || "", ...(s.apiKey ? { apiKey: s.apiKey } : {}), terminalId: s.terminalId || undefined, timeoutMs: Number(s.timeoutMs || 90000) }), { success: "TPE enregistré", invalidate: [["terminal-settings"], ["me"]] }).then(() => setF(null))}>Enregistrer</Button>
      </div>
    </Card>
  );
}
