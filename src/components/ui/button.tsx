"use client";

import { forwardRef } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "accent" | "outline";
type Size = "sm" | "md" | "lg" | "xl";

const variants: Record<Variant, string> = {
  primary: "bg-lagon-600 text-white hover:bg-lagon-700 active:bg-lagon-800 disabled:bg-lagon-600/50",
  accent: "bg-corail-500 text-white hover:bg-corail-600 active:bg-corail-600 disabled:bg-corail-500/50",
  secondary: "surface-2 text-[var(--text)] hover:brightness-95 dark:hover:brightness-125 border border-line",
  outline: "border border-line bg-transparent text-[var(--text)] hover:surface-2",
  ghost: "bg-transparent text-[var(--text)] hover:surface-2",
  danger: "bg-red-600 text-white hover:bg-red-700 disabled:bg-red-600/50",
};
const sizes: Record<Size, string> = {
  sm: "h-9 px-3 text-sm rounded-lg",
  md: "h-11 px-4 text-sm rounded-xl",
  lg: "h-14 px-6 text-base rounded-xl",
  xl: "h-16 px-7 text-lg rounded-2xl",
};

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "primary", size = "md", loading, className = "", children, disabled, ...props }, ref) {
  return (
    <button ref={ref} disabled={disabled || loading} className={`touch inline-flex items-center justify-center gap-2 font-semibold transition disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${className}`} {...props}>
      {loading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : null}
      {children}
    </button>
  );
});
