"use client";

import { useEffect, useState } from "react";
import { RESERVATION_TAGS } from "@/lib/reservations";
import { STATUS, counts, hhmmOf, minutesOf, type Resa } from "./shared";

type Table = { id: string; name: string; seats: number; room: string };
const PPM = 2.4; // pixels par minute
const toHHMM = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/**
 * Planning du service : une ligne par table, les réservations en barres sur l'axe des heures.
 * Un appui sur une case vide ouvre une réservation à cette heure et sur cette table.
 */
export function Planning({ list, tables, range, interval, timezone, isToday, onOpen, onNew }: {
  list: Resa[]; tables: Table[]; range: { from: string; to: string }; interval: number; timezone: string; isToday: boolean;
  onOpen: (r: Resa) => void; onNew: (p: { time: string; tableId?: string }) => void;
}) {
  const start = Math.floor((minutesOf(range.from) - 30) / 60) * 60;
  const end = Math.ceil((minutesOf(range.to) + 150) / 60) * 60;
  const width = (end - start) * PPM;
  const hours = Array.from({ length: (end - start) / 60 + 1 }, (_, i) => start + i * 60);
  const [now, setNow] = useState(() => minutesOf(hhmmOf(new Date(), timezone)));
  useEffect(() => { const t = setInterval(() => setNow(minutesOf(hhmmOf(new Date(), timezone))), 60_000); return () => clearInterval(t); }, [timezone]);

  const shown = list.filter(counts);
  const inRange = (r: Resa) => { const m = minutesOf(hhmmOf(r.startsAt, timezone)); return m + r.durationMinutes > start && m < end; };
  const unplaced = shown.filter((r) => !r.tableId && inRange(r));
  const rooms = [...new Set(tables.map((t) => t.room))];
  const pick = (e: React.MouseEvent<HTMLDivElement>, tableId?: string) => {
    if (e.target !== e.currentTarget) return;
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
    const m = Math.round((start + x / PPM) / interval) * interval;
    onNew({ time: toHHMM(Math.min(Math.max(m, start), end - interval)), tableId });
  };

  const Bar = ({ r }: { r: Resa }) => {
    const m = minutesOf(hhmmOf(r.startsAt, timezone));
    const st = STATUS[r.status];
    const tags = RESERVATION_TAGS.filter((t) => r.tags.includes(t.key)).map((t) => t.emoji).join("");
    return (
      <button data-testid="planning-bar" onClick={() => onOpen(r)} title={`${hhmmOf(r.startsAt, timezone)} · ${r.name} · ${r.partySize} pers. · ${st.label}`}
        className={`absolute top-1.5 bottom-1.5 flex items-center gap-1.5 overflow-hidden rounded-xl border-l-4 px-2 text-left text-xs shadow-sm transition hover:brightness-105 ${st.soft}`}
        style={{ left: (m - start) * PPM + 1, width: Math.max(r.durationMinutes * PPM - 3, 40), borderColor: st.dot }}>
        <span className="font-extrabold">{hhmmOf(r.startsAt, timezone)}</span>
        <span className="truncate font-bold">{r.name}</span>
        <span className="shrink-0 rounded-full bg-black/10 px-1.5 font-extrabold dark:bg-white/15">{r.partySize}</span>
        {r.allergies ? <span className="shrink-0 text-red-600" title={`Allergies : ${r.allergies}`}>⚠</span> : null}
        {tags ? <span className="shrink-0">{tags}</span> : null}
      </button>
    );
  };

  return (
    <div className="card overflow-x-auto" data-testid="planning">
      <div className="relative" style={{ width: width + 96 }}>
        {/* Axe des heures */}
        <div className="sticky top-0 z-10 flex h-9 border-b border-line surface">
          <div className="sticky left-0 z-10 w-24 shrink-0 border-r border-line surface" />
          <div className="relative" style={{ width }}>
            {hours.map((h, i) => <span key={h} className={`absolute top-2 text-xs font-bold text-muted ${i === 0 ? "pl-1.5" : "-translate-x-1/2"}`} style={{ left: (h - start) * PPM }}>{toHHMM(h)}</span>)}
          </div>
        </div>
        {unplaced.length ? (
          <Row label="À placer" hint={`${unplaced.length} résa`} width={width} onPick={(e) => pick(e)} hours={hours} start={start} highlight>
            {unplaced.map((r) => <Bar key={r.id} r={r} />)}
          </Row>
        ) : null}
        {rooms.map((room) => (
          <div key={room}>
            {rooms.length > 1 ? <div className="sticky left-0 border-b border-line surface-2 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-muted" style={{ width: width + 96 }}>{room}</div> : null}
            {tables.filter((t) => t.room === room).map((t) => (
              <Row key={t.id} label={t.name} hint={`${t.seats} pl.`} width={width} onPick={(e) => pick(e, t.id)} hours={hours} start={start}>
                {shown.filter((r) => r.tableId === t.id && inRange(r)).map((r) => <Bar key={r.id} r={r} />)}
              </Row>
            ))}
          </div>
        ))}
        {isToday && now > start && now < end ? <div className="pointer-events-none absolute bottom-0 top-9 z-[5] w-0.5 bg-red-500" style={{ left: 96 + (now - start) * PPM }}><span className="absolute -left-1 -top-1 h-2.5 w-2.5 rounded-full bg-red-500" /></div> : null}
      </div>
    </div>
  );
}

function Row({ label, hint, width, onPick, hours, start, highlight, children }: { label: string; hint: string; width: number; onPick: (e: React.MouseEvent<HTMLDivElement>) => void; hours: number[]; start: number; highlight?: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex h-14 border-b border-line last:border-b-0 ${highlight ? "bg-amber-500/5" : ""}`}>
      <div className="sticky left-0 z-[6] flex w-24 shrink-0 flex-col justify-center border-r border-line surface px-3"><span className="truncate text-sm font-extrabold">{label}</span><span className="text-[10px] font-semibold text-muted">{hint}</span></div>
      <div className="relative cursor-copy" style={{ width, backgroundImage: "linear-gradient(90deg, color-mix(in srgb, var(--border) 60%, transparent) 1px, transparent 1px)", backgroundSize: `${60 * PPM}px 100%`, backgroundPosition: `${(hours[0] - start) * PPM}px 0` }} onClick={onPick} aria-label={`Réserver ${label}`}>
        {children}
      </div>
    </div>
  );
}
