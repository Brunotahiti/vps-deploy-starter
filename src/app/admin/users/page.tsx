"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Select, Toggle } from "@/components/ui/field";
import { Spinner, Badge } from "@/components/ui/misc";
import { PageHeader, Table, Tr, Td, useAction, useList } from "@/components/admin/common";
import type { listUsers } from "@/server/services/users";
import type { listRoles } from "@/server/services/roles";

type U = Awaited<ReturnType<typeof listUsers>>[number];
type R = Awaited<ReturnType<typeof listRoles>>[number];
type Perm = { key: string; group: string; description: string };
type Form = { id?: string; email: string; password: string; currentPassword?: string; firstName: string; lastName: string; displayName: string; color: string; pin: string; isActive: boolean; memberships: { establishmentId: string; roleId: string }[] };

export default function UsersPage() {
  const { me } = useSession();
  const act = useAction();
  const [tab, setTab] = useState<"users" | "roles">("users");
  const users = useList<U[]>(["users"], "/api/users?all=1");
  const roles = useList<R[]>(["roles"], "/api/roles");
  const perms = useList<Perm[]>(["permissions"], "/api/permissions");
  const [edit, setEdit] = useState<Form | null>(null);
  const [roleEdit, setRoleEdit] = useState<{ id?: string; name: string; permissions: string[]; isSystem: boolean } | null>(null);
  const [invite, setInvite] = useState<{ email: string; firstName: string; lastName: string; memberships: { establishmentId: string; roleId: string }[] } | null>(null);
  const [sent, setSent] = useState<{ email: string; inviteUrl: string; emailSent: boolean } | null>(null);
  const [inviting, setInviting] = useState(false);
  const ests = me?.establishments ?? [];
  const assignable = roles.data?.filter((r) => r.key !== "owner") ?? [];

  const save = async () => {
    if (!edit) return;
    const body = { email: edit.email, firstName: edit.firstName, lastName: edit.lastName, displayName: edit.displayName || null, color: edit.color || null, isActive: edit.isActive, memberships: edit.memberships, ...(edit.password ? { password: edit.password, ...(edit.id === me?.user?.id ? { currentPassword: edit.currentPassword ?? "" } : {}) } : {}), ...(edit.pin ? { pin: edit.pin } : {}) };
    const r = await act(() => (edit.id ? api.patch(`/api/users/${edit.id}`, body) : api.post("/api/users", body)), { success: "Utilisateur enregistré", invalidate: [["users"]] });
    if (r) setEdit(null);
  };
  const sendInvite = async () => {
    if (!invite) return;
    setInviting(true);
    const r = await act(() => api.post<{ email: string; inviteUrl: string; emailSent: boolean }>("/api/users/invite", invite), { success: "Invitation créée", invalidate: [["users"]] });
    setInviting(false);
    if (r) { setInvite(null); setSent(r); }
  };
  const resend = async (u: U) => {
    const r = await act(() => api.post<{ email: string; inviteUrl: string; emailSent: boolean }>(`/api/users/${u.id}/invite`), { success: "Invitation renvoyée", invalidate: [["users"]] });
    if (r) setSent(r);
  };
  const copy = (v: string) => navigator.clipboard?.writeText(v);
  const saveRole = async () => {
    if (!roleEdit) return;
    const r = await act(() => (roleEdit.id ? api.patch(`/api/roles/${roleEdit.id}`, { name: roleEdit.name, permissions: roleEdit.permissions }) : api.post("/api/roles", { name: roleEdit.name, permissions: roleEdit.permissions })), { success: "Rôle enregistré", invalidate: [["roles"], ["me"]] });
    if (r) setRoleEdit(null);
  };
  const groups = [...new Set(perms.data?.map((p) => p.group) ?? [])];

  return (
    <div>
      <PageHeader title="Utilisateurs & rôles" subtitle="Comptes du personnel, PIN de caisse, rôles et permissions granulaires" action={tab === "users" ? <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={!roles.data || !me} onClick={() => setInvite({ email: "", firstName: "", lastName: "", memberships: me?.establishment ? [{ establishmentId: me.establishment.id, roleId: assignable.find((r) => r.key === "server")?.id ?? "" }] : [] })}>Inviter par e-mail</Button><Button disabled={!roles.data || !me} onClick={() => setEdit({ email: "", password: "", firstName: "", lastName: "", displayName: "", color: "#0EA5A4", pin: "", isActive: true, memberships: me?.establishment ? [{ establishmentId: me.establishment.id, roleId: assignable.find((r) => r.key === "server")?.id ?? "" }] : [] })}>Nouvel utilisateur</Button></div> : <Button onClick={() => setRoleEdit({ name: "", permissions: [], isSystem: false })}>Nouveau rôle</Button>} />
      <div className="mb-4 flex gap-1 border-b border-line">{(["users", "roles"] as const).map((t) => <button key={t} onClick={() => setTab(t)} className={`border-b-2 px-3 py-2 text-sm font-semibold ${tab === t ? "border-lagon-500 text-lagon-600" : "border-transparent text-muted"}`}>{t === "users" ? "Utilisateurs" : "Rôles & permissions"}</button>)}</div>
      {tab === "users" ? (users.isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : (
        <Table head={["Nom", "Email", "Rôle(s)", "PIN", "Statut", "Dernière connexion", ""]}>
          {users.data?.map((u) => (
            <Tr key={u.id}>
              <Td><span className="mr-2 inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: u.color ?? "#0ea5a4" }}>{u.firstName.slice(0, 1)}</span><span className="font-semibold">{u.firstName} {u.lastName}</span>{u.displayName ? <span className="text-muted"> ({u.displayName})</span> : null}</Td><Td>{u.email}</Td>
              <Td>{u.isOwner ? <Badge color="purple">Propriétaire</Badge> : u.memberships.map((m) => <span key={m.establishmentId} className="mr-1 inline-block rounded-md surface-2 px-1.5 py-0.5 text-xs">{m.role.name}{ests.length > 1 ? ` · ${m.establishment.name}` : ""}</span>)}</Td>
              <Td>{u.hasPin ? <Badge color="green">défini</Badge> : <Badge color="orange">aucun</Badge>}</Td><Td>{!u.isActive ? <Badge color="red">désactivé</Badge> : u.invitePending ? <span className="inline-flex flex-wrap items-center gap-1.5"><Badge color={u.inviteExpired ? "red" : "orange"}>{u.inviteExpired ? "invitation expirée" : "invitation en attente"}</Badge><button onClick={() => resend(u)} className="text-xs font-semibold text-lagon-600">Renvoyer</button></span> : "Actif"}</Td><Td className="text-xs text-muted">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString("fr-FR") : "—"}</Td>
              <Td><button onClick={() => setEdit({ id: u.id, email: u.email, password: "", firstName: u.firstName, lastName: u.lastName, displayName: u.displayName ?? "", color: u.color ?? "", pin: "", isActive: u.isActive, memberships: u.memberships.map((m) => ({ establishmentId: m.establishmentId, roleId: m.roleId })) })} className="text-xs font-semibold text-lagon-600">Modifier</button></Td>
            </Tr>
          ))}
        </Table>
      )) : (roles.isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : (
        <Table head={["Rôle", "Type", "Permissions", "Utilisateurs", ""]}>
          {roles.data?.map((r) => (
            <Tr key={r.id}><Td className="font-semibold">{r.name}</Td><Td>{r.isSystem ? <Badge color="teal">système</Badge> : <Badge color="gray">personnalisé</Badge>}</Td><Td className="text-xs text-muted">{r.key === "owner" ? "Toutes" : `${r.permissions.length} permissions`}</Td><Td>{r._count.memberships}</Td>
              <Td className="space-x-3">{r.key !== "owner" ? <button onClick={() => setRoleEdit({ id: r.id, name: r.name, permissions: r.permissions.map((p) => p.permissionKey), isSystem: r.isSystem })} className="text-xs font-semibold text-lagon-600">Permissions</button> : null}{!r.isSystem ? <button onClick={() => confirm("Supprimer ce rôle ?") && act(() => api.delete(`/api/roles/${r.id}`), { success: "Rôle supprimé", invalidate: [["roles"]] })} className="text-xs font-semibold text-red-600">Supprimer</button> : null}</Td></Tr>
          ))}
        </Table>
      ))}

      <Modal open={!!invite} onClose={() => setInvite(null)} title="Inviter un membre de l'équipe" size="lg" footer={<Button className="w-full" disabled={inviting || !invite?.email.includes("@") || !invite?.firstName || !invite?.lastName || !invite?.memberships.length || invite.memberships.some((m) => !m.roleId)} onClick={sendInvite}>{inviting ? "Envoi…" : "Envoyer l'invitation"}</Button>}>
        {invite ? (
          <div className="space-y-3">
            <p className="text-sm text-muted">La personne reçoit un e-mail avec un lien pour choisir son mot de passe et son PIN de caisse. Le lien est valable 7 jours ; vous pourrez aussi le copier pour l&apos;envoyer vous-même.</p>
            <Field label="Adresse e-mail"><Input type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} placeholder="prenom@exemple.pf" autoComplete="off" /></Field>
            <div className="grid gap-3 sm:grid-cols-2"><Field label="Prénom"><Input value={invite.firstName} onChange={(e) => setInvite({ ...invite, firstName: e.target.value })} /></Field><Field label="Nom"><Input value={invite.lastName} onChange={(e) => setInvite({ ...invite, lastName: e.target.value })} /></Field></div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Rôle par établissement</p>
              {invite.memberships.map((m, i) => (
                <div key={i} className="mb-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                  <Select value={m.establishmentId} onChange={(e) => setInvite({ ...invite, memberships: invite.memberships.map((x, j) => (j === i ? { ...x, establishmentId: e.target.value } : x)) })}>{ests.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</Select>
                  <Select value={m.roleId} onChange={(e) => setInvite({ ...invite, memberships: invite.memberships.map((x, j) => (j === i ? { ...x, roleId: e.target.value } : x)) })}><option value="">Rôle…</option>{assignable.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>
                  <button onClick={() => setInvite({ ...invite, memberships: invite.memberships.filter((_, j) => j !== i) })} className="text-xs font-semibold text-red-600">Retirer</button>
                </div>
              ))}
              {ests.length > invite.memberships.length ? <button onClick={() => setInvite({ ...invite, memberships: [...invite.memberships, { establishmentId: ests.find((e) => !invite.memberships.some((m) => m.establishmentId === e.id))?.id ?? ests[0].id, roleId: "" }] })} className="text-xs font-semibold text-lagon-600">+ Ajouter un établissement</button> : null}
            </div>
          </div>
        ) : null}
      </Modal>
      <Modal open={!!sent} onClose={() => setSent(null)} title="Invitation prête" footer={<Button className="w-full" onClick={() => setSent(null)}>Fermer</Button>}>
        {sent ? (
          <div className="space-y-3 text-sm" data-testid="invite-sent">
            <p>{sent.emailSent ? <>Un e-mail d&apos;invitation a été envoyé à <b>{sent.email}</b>.</> : <>L&apos;envoi d&apos;e-mail n&apos;est pas configuré sur ce serveur : transmettez ce lien à <b>{sent.email}</b> (WhatsApp, SMS…).</>}</p>
            <div className="rounded-xl surface-2 p-3"><p className="mb-1 text-xs font-bold uppercase text-muted">Lien d&apos;invitation (valable 7 jours)</p><p className="flex items-center gap-2"><code className="min-w-0 flex-1 truncate text-xs" data-testid="invite-url">{sent.inviteUrl}</code><button onClick={() => copy(sent.inviteUrl)} className="font-semibold text-lagon-600">Copier</button></p></div>
          </div>
        ) : null}
      </Modal>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Modifier l'utilisateur" : "Nouvel utilisateur"} size="lg" footer={<Button className="w-full" disabled={!edit?.email || !edit.firstName || !edit.lastName || (!edit.id && edit.password.length < 8) || edit.memberships.some((m) => !m.roleId)} onClick={save}>Enregistrer</Button>}>
        {edit ? <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Prénom"><Input value={edit.firstName} onChange={(e) => setEdit({ ...edit, firstName: e.target.value })} /></Field><Field label="Nom"><Input value={edit.lastName} onChange={(e) => setEdit({ ...edit, lastName: e.target.value })} /></Field>
          <Field label="Email"><Input type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field><Field label="Nom affiché en caisse"><Input value={edit.displayName} onChange={(e) => setEdit({ ...edit, displayName: e.target.value })} /></Field>
          <Field label={edit.id ? "Nouveau mot de passe (laisser vide)" : "Mot de passe (8 car. min.)"}><Input type="password" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} /></Field>{edit.id && edit.id === me?.user?.id && edit.password ? <Field label="Mot de passe actuel"><Input type="password" autoComplete="current-password" value={edit.currentPassword ?? ""} onChange={(e) => setEdit({ ...edit, currentPassword: e.target.value })} /></Field> : null}<Field label={edit.id ? "Nouveau PIN (laisser vide)" : "PIN caisse (4 à 6 chiffres)"}><Input inputMode="numeric" value={edit.pin} onChange={(e) => setEdit({ ...edit, pin: e.target.value.replace(/\D/g, "").slice(0, 6) })} /></Field>
          <Field label="Couleur"><Input type="color" value={edit.color || "#0ea5a4"} onChange={(e) => setEdit({ ...edit, color: e.target.value })} className="h-11 p-1" /></Field>
          <div className="flex items-end"><Toggle checked={edit.isActive} onChange={(v) => setEdit({ ...edit, isActive: v })} label="Compte actif" /></div>
          <div className="sm:col-span-2"><p className="mb-1 text-xs font-semibold uppercase text-muted">Accès par établissement</p>
            {ests.map((e) => { const m = edit.memberships.find((x) => x.establishmentId === e.id); return <div key={e.id} className="mb-1 flex items-center gap-2"><Toggle checked={!!m} onChange={(v) => setEdit({ ...edit, memberships: v ? [...edit.memberships, { establishmentId: e.id, roleId: assignable[0]?.id ?? "" }] : edit.memberships.filter((x) => x.establishmentId !== e.id) })} /><span className="w-40 truncate text-sm font-semibold">{e.name}</span>{m ? <Select value={m.roleId} onChange={(ev) => setEdit({ ...edit, memberships: edit.memberships.map((x) => (x.establishmentId === e.id ? { ...x, roleId: ev.target.value } : x)) })} className="flex-1"><option value="">Choisir un rôle</option>{assignable.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select> : null}</div>; })}
          </div>
        </div> : null}
      </Modal>
      <Modal open={!!roleEdit} onClose={() => setRoleEdit(null)} title={roleEdit?.id ? `Permissions — ${roleEdit.name}` : "Nouveau rôle"} size="lg" footer={<Button className="w-full" disabled={!roleEdit?.name} onClick={saveRole}>Enregistrer</Button>}>
        {roleEdit ? <div className="space-y-4">
          <Field label="Nom du rôle"><Input value={roleEdit.name} onChange={(e) => setRoleEdit({ ...roleEdit, name: e.target.value })} /></Field>
          {groups.map((g) => <div key={g}><p className="mb-1 text-xs font-bold uppercase text-muted">{g}</p><div className="grid gap-1 sm:grid-cols-2">{perms.data?.filter((p) => p.group === g).map((p) => <label key={p.key} className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm hover:surface-2"><input type="checkbox" checked={roleEdit.permissions.includes(p.key)} onChange={(e) => setRoleEdit({ ...roleEdit, permissions: e.target.checked ? [...roleEdit.permissions, p.key] : roleEdit.permissions.filter((k) => k !== p.key) })} className="h-4 w-4 accent-lagon-600" /><span>{p.description}<span className="block font-mono text-[10px] text-muted">{p.key}</span></span></label>)}</div></div>)}
        </div> : null}
      </Modal>
    </div>
  );
}
