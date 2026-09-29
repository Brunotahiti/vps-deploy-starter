"use client";

import { Delete } from "lucide-react";

/** Pavé numérique tactile (montants, PIN). */
export function NumPad({ value, onChange, onSubmit, submitLabel = "OK", maxLength = 9, disabled, extraKeys }: { value: string; onChange: (v: string) => void; onSubmit?: () => void; submitLabel?: string; maxLength?: number; disabled?: boolean; extraKeys?: { label: string; onPress: () => void }[] }) {
  const press = (k: string) => {
    if (disabled) return;
    if (k === "⌫") return onChange(value.slice(0, -1));
    if (k === "C") return onChange("");
    if (value.length >= maxLength) return;
    if (k === "00" && value === "") return;
    onChange(value === "0" ? k : value + k);
  };
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "00"];
  return (
    <div className="grid grid-cols-3 gap-2">
      {keys.map((k) => (
        <button key={k} type="button" disabled={disabled} onClick={() => press(k)} className={`touch h-14 rounded-xl text-xl font-bold transition active:scale-95 ${k === "C" ? "bg-red-500/15 text-red-600 dark:text-red-400" : "surface-2 hover:brightness-95 dark:hover:brightness-125"}`}>
          {k}
        </button>
      ))}
      <button type="button" disabled={disabled} onClick={() => press("⌫")} className="touch h-14 rounded-xl surface-2 flex items-center justify-center"><Delete className="h-6 w-6" /></button>
      {extraKeys?.map((k) => (
        <button key={k.label} type="button" disabled={disabled} onClick={k.onPress} className="touch h-14 rounded-xl border border-line text-sm font-semibold">{k.label}</button>
      ))}
      {onSubmit ? (
        <button type="button" disabled={disabled} onClick={onSubmit} className={`touch h-14 rounded-xl bg-lagon-600 text-lg font-bold text-white active:bg-lagon-800 ${extraKeys?.length ? "" : "col-span-2"}`}>{submitLabel}</button>
      ) : null}
    </div>
  );
}
