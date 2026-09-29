"use client";

import { useCallback, useState } from "react";

export type Theme = "light" | "dark" | "system";

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === "undefined") return "system";
    try { return (localStorage.getItem("mr-theme") as Theme) || "system"; } catch { return "system"; }
  });
  const apply = useCallback((t: Theme) => {
    const resolved = t === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : t;
    document.documentElement.setAttribute("data-theme", resolved);
  }, []);
  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try { localStorage.setItem("mr-theme", t); } catch {}
    apply(t);
  }, [apply]);
  const toggle = useCallback(() => {
    const current = document.documentElement.getAttribute("data-theme");
    setTheme(current === "dark" ? "light" : "dark");
  }, [setTheme]);
  return { theme, setTheme, toggle };
}
