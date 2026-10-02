"use client";

import { createContext, useCallback, useContext, useState } from "react";

type Toast = { id: number; message: string; kind: "info" | "success" | "error" };
const Ctx = createContext<{ toast: (message: string, kind?: Toast["kind"]) => void }>({ toast: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const toast = useCallback((message: string, kind: Toast["kind"] = "info") => {
    // Jamais de notification vide (une pastille de couleur sans texte n'explique rien)
    if (!message.trim()) message = kind === "error" ? "Une erreur est survenue : réessayez" : "C'est fait";
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, message, kind }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), kind === "error" ? 5000 : 2800);
  }, []);
  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-4">
        {items.map((t) => (
          <div key={t.id} className={`pointer-events-auto rounded-xl px-4 py-3 text-sm font-medium shadow-lg ${t.kind === "error" ? "bg-red-600 text-white" : t.kind === "success" ? "bg-lagon-600 text-white" : "bg-nuit-800 text-white"}`}>
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
