"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

/** Pile des modales ouvertes : seule celle du dessus réagit à la touche Échap. */
const stack: symbol[] = [];

export function Modal({ open, onClose, title, children, size = "md", footer }: { open: boolean; onClose: () => void; title?: string; children: React.ReactNode; size?: "sm" | "md" | "lg" | "xl" | "full"; footer?: React.ReactNode }) {
  const id = useRef(Symbol("modal"));
  useEffect(() => {
    if (!open) return;
    const me = id.current;
    stack.push(me);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && stack[stack.length - 1] === me) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); const i = stack.indexOf(me); if (i >= 0) stack.splice(i, 1); };
  }, [open, onClose]);
  if (!open) return null;
  const width = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl", xl: "max-w-5xl", full: "max-w-[96vw]" }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`surface flex max-h-[95vh] w-full ${width} flex-col rounded-t-2xl border shadow-2xl sm:rounded-2xl`}>
        {title ? (
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="text-lg font-bold">{title}</h2>
            <button className="touch rounded-lg p-2 hover:surface-2" onClick={onClose} aria-label="Fermer"><X className="h-5 w-5" /></button>
          </div>
        ) : null}
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="border-t border-line px-5 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}
