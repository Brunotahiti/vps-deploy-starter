"use client";

import { useRef, useState } from "react";
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
      <PageHeader title="Plan de salle" subtitle="Glissez les tables, ajustez forme, taille et nombre de places. Pensez à enregistrer." action={<div className="flex gap-2"><Button variant="secondary" onClick={() => setRoomModal({ name: "", kind: "INDOOR", width: "1200", height: "800" })}>+ Salle</Button><Button variant="secondary" onClick={addTable} disabled={!room}>+ Table</Button><Button onClick={save} disabled={!dirty}>Enregistrer{dirty ? " *" : ""}</Button></div>} />
      {rooms.isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : null}
      <div className="mb-3 flex flex-wrap gap-2">
        {rooms.data?.map((r) => <button key={r.id} onClick={() => { if (dirty && !confirm("Modifications non enregistrées, continuer ?")) return; setRoomId(r.id); setDirty(false); setSel(null); }} className={`touch h-10 rounded-xl px-4 text-sm font-bold ${r.id === room?.id ? "bg-lagon-600 text-white" : "surface-2"}`}>{r.name} <span className="opacity-70">({r.tables.length})</span></button>)}
        {room ? <button onClick={() => setRoomModal({ id: room.id, name: room.name, kind: room.kind, width: String(room.width), height: String(room.height) })} className="touch h-10 rounded-xl border border-line px-3 text-sm font-semibold">Modifier la salle</button> : null}
        {room ? <button onClick={() => confirm(`Supprimer la salle « ${room.name} » et ses tables ?`) && act(() => api.delete(`/api/rooms/${room.id}`), { success: "Salle supprimée", invalidate: [["rooms"], ["floor"]] }).then(() => setRoomId(null))} className="touch h-10 rounded-xl px-3 text-sm font-semibold text-red-600">Supprimer la salle</button> : null}
      </div>
      {room ? (
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[1fr_260px]">
          <div ref={canvas} onPointerMove={onMove} onPointerUp={onUp} className="relative select-none overflow-hidden rounded-2xl border-2 border-dashed border-line surface-2" style={{ aspectRatio: `${room.width} / ${room.height}`, backgroundImage: "radial-gradient(circle, var(--border) 1px, transparent 1px)", backgroundSize: "3% 3%" }}>
            {tables.map((t) => (
              <div key={t.id} onPointerDown={(e) => onDown(e, t)} className={`absolute flex cursor-grab items-center justify-center font-bold text-white active:cursor-grabbing ${sel === t.id ? "ring-4 ring-corail-500" : ""}`}
                style={{ left: `${(t.x / room.width) * 100}%`, top: `${(t.y / room.height) * 100}%`, width: `${(t.width / room.width) * 100}%`, height: `${(t.height / room.height) * 100}%`, background: "#0ea5a4", borderRadius: t.shape === "ROUND" ? "9999px" : 12, transform: `rotate(${t.rotation}deg)`, touchAction: "none" }}>
                {t.name}<span className="ml-1 text-xs opacity-80">({t.seats})</span>
              </div>
            ))}
          </div>
          <div className="surface rounded-2xl border p-4">
            {selected ? (
              <div className="space-y-3">
                <Field label="Nom"><Input value={selected.name} onChange={(e) => update({ name: e.target.value })} /></Field>
                <Field label="Places"><Input type="number" min={1} value={selected.seats} onChange={(e) => update({ seats: Number(e.target.value) })} /></Field>
                <Field label="Forme"><Select value={selected.shape} onChange={(e) => update({ shape: e.target.value as T["shape"], ...(e.target.value === "RECT" ? { width: Math.max(selected.width, 160) } : { width: selected.height }) })}><option value="ROUND">Ronde</option><option value="SQUARE">Carrée</option><option value="RECT">Rectangulaire</option></Select></Field>
                <div className="grid grid-cols-2 gap-2"><Field label="Largeur"><Input type="number" min={40} value={selected.width} onChange={(e) => update({ width: Number(e.target.value) })} /></Field><Field label="Hauteur"><Input type="number" min={40} value={selected.height} onChange={(e) => update({ height: Number(e.target.value) })} /></Field></div>
                <Field label="Rotation (°)"><Input type="number" step={15} value={selected.rotation} onChange={(e) => update({ rotation: Number(e.target.value) })} /></Field>
                <Button variant="danger" size="sm" className="w-full" onClick={removeTable}>Supprimer la table</Button>
              </div>
            ) : <p className="text-sm text-muted">Sélectionnez une table pour modifier ses propriétés, ou glissez-la pour la déplacer.</p>}
          </div>
        </div>
      ) : !rooms.isLoading ? <p className="text-sm text-muted">Aucune salle : commencez par en créer une.</p> : null}
      <Modal open={!!roomModal} onClose={() => setRoomModal(null)} title={roomModal?.id ? "Modifier la salle" : "Nouvelle salle"} size="sm" footer={<Button className="w-full" disabled={!roomModal?.name} onClick={saveRoom}>Enregistrer</Button>}>
        {roomModal ? <div className="space-y-3"><Field label="Nom"><Input value={roomModal.name} onChange={(e) => setRoomModal({ ...roomModal, name: e.target.value })} placeholder="Salle, Terrasse…" /></Field><Field label="Type"><Select value={roomModal.kind} onChange={(e) => setRoomModal({ ...roomModal, kind: e.target.value })}><option value="INDOOR">Salle intérieure</option><option value="TERRACE">Terrasse</option><option value="BAR">Bar</option><option value="OTHER">Autre</option></Select></Field><div className="grid grid-cols-2 gap-2"><Field label="Largeur (unités)"><Input type="number" value={roomModal.width} onChange={(e) => setRoomModal({ ...roomModal, width: e.target.value })} /></Field><Field label="Hauteur"><Input type="number" value={roomModal.height} onChange={(e) => setRoomModal({ ...roomModal, height: e.target.value })} /></Field></div></div> : null}
      </Modal>
    </div>
  );
}
