"use client";

import { forwardRef } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "accent" | "outline";
type Size = "sm" | "md" | "lg" | "xl";

const variants: Record<Variant, string> = {
  primary: "bg-brand text-white shadow-glow hover:brightness-110 active:brightness-95 disabled:opacity-50 disabled:shadow-none",
  accent: "bg-accent text-white shadow-[0_8px_24px_-8px_rgb(249_124_60/0.5)] hover:brightness-110 active:brightness-95 disabled:opacity-50 disabled:shadow-none",
  secondary: "surface-2 text-[var(--text)] border border-line hover:surface-3 active:brightness-95",
  outline: "border border-line bg-transparent text-[var(--text)] hover:surface-2",
  ghost: "bg-transparent text-[var(--text)] hover:surface-2",
  danger: "bg-red-600 text-white shadow-[0_8px_24px_-8px_rgb(220_38_38/0.5)] hover:bg-red-700 disabled:opacity-50 disabled:shadow-none",
};
const sizes: Record<Size, string> = {
  sm: "h-9 px-3 text-sm rounded-xl",
  md: "h-11 px-4 text-sm rounded-xl",
  lg: "h-14 px-6 text-base rounded-2xl",
  xl: "h-16 px-7 text-lg rounded-2xl",
};

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "primary", size = "md", loading, className = "", children, disabled, ...props }, ref) {
  return (
    <button ref={ref} disabled={disabled || loading} className={`touch inline-flex items-center justify-center gap-2 font-semibold transition-all duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 ${variants[variant]} ${sizes[size]} ${className}`} {...props}>
      {loading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : null}
      {children}
    </button>
  );
});
