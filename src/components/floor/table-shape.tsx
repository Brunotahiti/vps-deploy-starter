"use client";

/**
 * Table vue du dessus avec ses chaises, comme sur un plan de restaurant.
 * Le bloc occupe toute la zone de la table (chaises comprises) ; le plateau est au centre.
 * `seats` chaises réparties autour : en cercle (ROUND) ou sur les quatre côtés (SQUARE / RECT).
 */
export type TableShapeKind = "ROUND" | "SQUARE" | "RECT";

const CHAIR = 0.14; // épaisseur de la couronne des chaises (fraction du côté)

export function chairPositions(shape: TableShapeKind, seats: number, ratio: number): { x: number; y: number; angle: number }[] {
  const n = Math.max(0, Math.min(seats, 24));
  if (n === 0) return [];
  if (shape === "ROUND") return Array.from({ length: n }, (_, i) => { const a = -Math.PI / 2 + (i / n) * 2 * Math.PI; return { x: 0.5 + 0.5 * Math.cos(a), y: 0.5 + 0.5 * Math.sin(a), angle: (a * 180) / Math.PI + 90 }; });
  // Rectangle : répartition proportionnelle au périmètre, les longs côtés d'abord
  const w = ratio >= 1 ? ratio : 1, h = ratio >= 1 ? 1 : 1 / ratio;
  const perim = 2 * (w + h);
  const sides: ["top" | "bottom" | "left" | "right", number][] = w >= h ? [["top", w / perim], ["bottom", w / perim], ["left", h / perim], ["right", h / perim]] : [["left", h / perim], ["right", h / perim], ["top", w / perim], ["bottom", w / perim]];
  const counts = sides.map(([, share]) => Math.floor(share * n));
  let rest = n - counts.reduce((a, b) => a + b, 0);
  for (let i = 0; rest > 0; i = (i + 1) % sides.length) { counts[i]++; rest--; }
  const out: { x: number; y: number; angle: number }[] = [];
  sides.forEach(([side], si) => {
    const c = counts[si];
    for (let k = 0; k < c; k++) {
      const t = (k + 1) / (c + 1);
      if (side === "top") out.push({ x: t, y: 0, angle: 0 });
      if (side === "bottom") out.push({ x: t, y: 1, angle: 180 });
      if (side === "left") out.push({ x: 0, y: t, angle: -90 });
      if (side === "right") out.push({ x: 1, y: t, angle: 90 });
    }
  });
  return out;
}

export function TableTop({ shape, seats, width, height, color, chairColor, children, className = "", style }: { shape: TableShapeKind; seats: number; width: number; height: number; color: string; chairColor?: string; children?: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  const ratio = shape === "ROUND" || shape === "SQUARE" ? 1 : width / Math.max(height, 1);
  const chairs = chairPositions(shape, seats, ratio);
  const chair = chairColor ?? "color-mix(in srgb, var(--text) 22%, transparent)";
  return (
    <div className={`relative ${className}`} style={style}>
      {chairs.map((c, i) => (
        <span key={i} aria-hidden className="absolute" style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${CHAIR * 130}%`, height: `${CHAIR * 100}%`, transform: `translate(-50%, -50%) rotate(${c.angle}deg)`, maxWidth: 30, maxHeight: 22, minWidth: 12, minHeight: 9 }}>
          <span className="block h-full w-full rounded-[40%_40%_30%_30%]" style={{ background: chair, boxShadow: "inset 0 -2px 0 rgb(0 0 0 / .12), 0 1px 2px rgb(0 0 0 / .15)" }} />
        </span>
      ))}
      <div className="absolute flex flex-col items-center justify-center overflow-hidden" style={{ inset: `${CHAIR * 100}%`, borderRadius: shape === "ROUND" ? "9999px" : "16%", background: color, boxShadow: "inset 0 0 0 3px rgb(255 255 255 / .35), 0 6px 16px -6px rgb(0 0 0 / .35)" }}>
        {children}
      </div>
    </div>
  );
}
