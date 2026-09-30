"use client";

import { useRef, useState } from "react";
import { Pencil, Plus, Save, Trash2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Select } from "@/components/ui/field";
import { Spinner } from "@/components/ui/misc";
import { PageHeader, useAction, useList } from "@/components/admin/common";
import type { listRooms } from "@/server/services/floor";

type Room = Awaited<ReturnType<typeof listRooms>>[number];
type T = Room["tables"][number];

export default function FloorEditor() {
  const act = useAction();
  const rooms = useList<Room[]>(["rooms"], "/api/rooms");
  const [roomId, setRoomId] = useState<string | null>(null);
  const [localTables, setLocalTables] = useState<T[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [roomModal, setRoomModal] = useState<{ id?: string; name: string; kind: string; width: string; height: string } | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const room = rooms.data?.find((r) => r.id === roomId) ?? rooms.data?.[0];
  const tables = localTables ?? room?.tables ?? [];
  const dirty = localTables !== null;
  const setTables = (fn: (ts: T[]) => T[]) => setLocalTables(fn(tables));
  const setDirty = (v: boolean) => { if (!v) setLocalTables(null); };

  const scale = () => (canvas.current && room ? canvas.current.clientWidth / room.width : 1);
  const onDown = (e: React.PointerEvent, t: T) => { const s = scale(); drag.current = { id: t.id, dx: e.clientX / s - t.x, dy: e.clientY / s - t.y }; setSel(t.id); (e.target as HTMLElement).setPointerCapture(e.pointerId); };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current || !room) return;
    const s = scale();
    const { id, dx, dy } = drag.current;
    setTables((ts) => ts.map((t) => (t.id === id ? { ...t, x: Math.round(Math.max(0, Math.min(room.width - t.width, e.clientX / s - dx)) / 10) * 10, y: Math.round(Math.max(0, Math.min(room.height - t.height, e.clientY / s - dy)) / 10) * 10 } : t)));
    setDirty(true);
  };
  const onUp = () => { drag.current = null; };
  const update = (patch: Partial<T>) => { setTables((ts) => ts.map((t) => (t.id === sel ? { ...t, ...patch } : t))); setDirty(true); };
  const selected = tables.find((t) => t.id === sel);

  const save = async () => {
    const r = await act(() => api.put("/api/floor/layout", { tables: tables.map((t) => ({ id: t.id, x: t.x, y: t.y, width: t.width, height: t.height, rotation: t.rotation, shape: t.shape, seats: t.seats, name: t.name })) }), { success: "Plan enregistré", invalidate: [["rooms"], ["floor"]] });
    if (r) setDirty(false);
  };
  const addTable = async () => {
    if (!room) return;
    const n = tables.length + 1;
    const name = `T${String(n).padStart(2, "0")}`;
    await act(() => api.post("/api/tables", { roomId: room.id, name: tables.some((t) => t.name === name) ? `T${Date.now().toString().slice(-4)}` : name, seats: 2, x: 40 + (n % 5) * 130, y: 40 + Math.floor(n / 5) * 130 }), { success: "Table ajoutée", invalidate: [["rooms"], ["floor"]] });
    setDirty(false);
  };
  const removeTable = async () => { if (!selected || !confirm(`Supprimer ${selected.name} ?`)) return; await act(() => api.delete(`/api/tables/${selected.id}`), { success: "Table supprimée", invalidate: [["rooms"], ["floor"]] }); setSel(null); setDirty(false); };
  const saveRoom = async () => {
    if (!roomModal) return;
    const body = { name: roomModal.name, kind: roomModal.kind, width: Number(roomModal.width), height: Number(roomModal.height) };
    const r = await act(() => (roomModal.id ? api.patch(`/api/rooms/${roomModal.id}`, body) : api.post<{ id: string }>("/api/rooms", body)), { success: "Salle enregistrée", invalidate: [["rooms"], ["floor"]] });
    if (r) { setRoomModal(null); if (!roomModal.id && r && typeof r === "object" && "id" in r) setRoomId((r as { id: string }).id); }
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Plan de salle" subtitle="Glissez les tables, touchez-en une pour la modifier, puis enregistrez." action={
        <div className="flex gap-2">
          <Button variant="secondary" onClick={addTable} disabled={!room}><Plus className="h-4 w-4" /> Table</Button>
          <Button variant={dirty ? "accent" : "primary"} onClick={save} disabled={!dirty}><Save className="h-4 w-4" /> Enregistrer{dirty ? " •" : ""}</Button>
        </div>
      } />
      {rooms.isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : null}
      <div className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:px-0">
        {rooms.data?.map((r) => (
          <span key={r.id} className={`flex shrink-0 items-center rounded-xl ${r.id === room?.id ? "bg-brand text-white shadow-glow" : "surface-2"}`}>
            <button onClick={() => { if (dirty && !confirm("Modifications non enregistrées, continuer ?")) return; setRoomId(r.id); setDirty(false); setSel(null); }} className="touch h-10 pl-4 pr-3 text-sm font-bold">{r.name} <span className="text-xs opacity-75">({r.tables.length})</span></button>
            {r.id === room?.id ? <button onClick={() => setRoomModal({ id: room.id, name: room.name, kind: room.kind, width: String(room.width), height: String(room.height) })} className="touch flex h-10 w-9 items-center justify-center rounded-r-xl hover:bg-white/15" title="Modifier la salle" aria-label="Modifier la salle"><Pencil className="h-3.5 w-3.5" /></button> : null}
          </span>
        ))}
        <button onClick={() => setRoomModal({ name: "", kind: "INDOOR", width: "1200", height: "800" })} className="touch flex h-10 shrink-0 items-center gap-1 rounded-xl border border-dashed border-line px-3 text-sm font-semibold text-muted hover:surface-2"><Plus className="h-4 w-4" /> Salle</button>
      </div>
      {room ? (
        <div className="grid min-h-0 flex-1 auto-rows-min gap-3 lg:grid-cols-[1fr_260px] lg:gap-4">
          <div ref={canvas} onPointerMove={onMove} onPointerUp={onUp} className="relative select-none overflow-hidden rounded-2xl border border-line surface-2 shadow-inner" style={{ aspectRatio: `${room.width} / ${room.height}`, containerType: "inline-size", backgroundImage: "linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)", backgroundSize: "8.333% 12.5%" }}>
            {tables.map((t) => {
              const w = (t.width / room.width) * 100, h = (t.height / room.height) * 100;
              return (
                <div key={t.id} onPointerDown={(e) => onDown(e, t)} className={`absolute flex cursor-grab flex-col items-center justify-center bg-brand leading-none text-white shadow-lift transition-shadow active:cursor-grabbing ${sel === t.id ? "ring-4 ring-corail-500 ring-offset-2 ring-offset-[var(--surface-2)]" : ""}`}
                  style={{ left: `${(t.x / room.width) * 100}%`, top: `${(t.y / room.height) * 100}%`, width: `${w}%`, height: `${h}%`, borderRadius: t.shape === "ROUND" ? "9999px" : "16%", transform: `rotate(${t.rotation}deg)`, touchAction: "none", fontSize: `clamp(9px, ${Math.min(w, h) * 0.22}cqw, 18px)` }}>
                  <span className="font-extrabold">{t.name}</span>
                  <span className="mt-[0.2em] text-[0.7em] font-semibold opacity-85">{t.seats} pl.</span>
                </div>
              );
            })}
          </div>
          <div className={`card p-3 lg:p-4 ${selected ? "" : "lg:block"}`}>
            {selected ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between"><p className="text-sm font-extrabold">{selected.name}</p><button onClick={() => setSel(null)} className="text-xs font-semibold text-muted lg:hidden">Fermer</button></div>
                <div className="grid grid-cols-3 gap-2 lg:grid-cols-1">
                  <Field label="Nom"><Input value={selected.name} onChange={(e) => update({ name: e.target.value })} /></Field>
                  <Field label="Places"><Input type="number" min={1} value={selected.seats} onChange={(e) => update({ seats: Number(e.target.value) })} /></Field>
                  <Field label="Forme"><Select value={selected.shape} onChange={(e) => update({ shape: e.target.value as T["shape"], ...(e.target.value === "RECT" ? { width: Math.max(selected.width, 160) } : { width: selected.height }) })}><option value="ROUND">Ronde</option><option value="SQUARE">Carrée</option><option value="RECT">Rectangle</option></Select></Field>
                  <Field label="Largeur"><Input type="number" min={40} step={10} value={selected.width} onChange={(e) => update({ width: Number(e.target.value) })} /></Field>
                  <Field label="Hauteur"><Input type="number" min={40} step={10} value={selected.height} onChange={(e) => update({ height: Number(e.target.value) })} /></Field>
                  <Field label="Rotation (°)"><Input type="number" step={15} value={selected.rotation} onChange={(e) => update({ rotation: Number(e.target.value) })} /></Field>
                </div>
                <Button variant="danger" size="sm" className="w-full" onClick={removeTable}><Trash2 className="h-4 w-4" /> Supprimer la table</Button>
              </div>
            ) : <p className="text-sm text-muted">Touchez une table pour modifier son nom, ses places ou sa forme. Glissez-la pour la déplacer.</p>}
          </div>
        </div>
      ) : !rooms.isLoading ? <p className="text-sm text-muted">Aucune salle : commencez par en créer une.</p> : null}
      <Modal open={!!roomModal} onClose={() => setRoomModal(null)} title={roomModal?.id ? "Modifier la salle" : "Nouvelle salle"} size="sm" footer={<div className="flex w-full gap-2">{roomModal?.id ? <Button variant="danger" onClick={() => { const id = roomModal.id!; const name = roomModal.name; if (!confirm(`Supprimer la salle « ${name} » et ses tables ?`)) return; act(() => api.delete(`/api/rooms/${id}`), { success: "Salle supprimée", invalidate: [["rooms"], ["floor"]] }).then(() => { setRoomModal(null); setRoomId(null); }); }}><Trash2 className="h-4 w-4" /></Button> : null}<Button className="flex-1" disabled={!roomModal?.name} onClick={saveRoom}>Enregistrer</Button></div>}>
        {roomModal ? <div className="space-y-3"><Field label="Nom"><Input value={roomModal.name} onChange={(e) => setRoomModal({ ...roomModal, name: e.target.value })} placeholder="Salle, Terrasse…" /></Field><Field label="Type"><Select value={roomModal.kind} onChange={(e) => setRoomModal({ ...roomModal, kind: e.target.value })}><option value="INDOOR">Salle intérieure</option><option value="TERRACE">Terrasse</option><option value="BAR">Bar</option><option value="OTHER">Autre</option></Select></Field><div className="grid grid-cols-2 gap-2"><Field label="Largeur (unités)"><Input type="number" value={roomModal.width} onChange={(e) => setRoomModal({ ...roomModal, width: e.target.value })} /></Field><Field label="Hauteur"><Input type="number" value={roomModal.height} onChange={(e) => setRoomModal({ ...roomModal, height: e.target.value })} /></Field></div></div> : null}
      </Modal>
    </div>
  );
}
