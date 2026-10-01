import { COURSE_STATE_LABEL, courseColor, courseLabel, type CourseState, type MealStage } from "@/lib/meal-stage";

/**
 * Pastille d'une suite : pleine = servie, cerclée = en cuisine, clignotante = prête, vide = pas encore envoyée.
 * Initiale de la suite (A, E, P, D) dans la couleur de sa catégorie.
 */
export function StepDot({ name, state, size = "sm" }: { name: string; state: CourseState; size?: "sm" | "md" }) {
  const color = courseColor(name);
  const dim = size === "md" ? "h-5 min-w-5 text-[10px]" : "h-4 min-w-4 text-[9px]";
  const style =
    state === "SERVED" ? { background: color, color: "#fff" }
      : state === "READY" ? { background: color, color: "#fff", boxShadow: `0 0 0 2px var(--surface), 0 0 0 4px ${color}` }
        : state === "COOKING" ? { background: "var(--surface)", color, boxShadow: `inset 0 0 0 2px ${color}` }
          : { background: "var(--surface-2)", color: "var(--muted)", boxShadow: "inset 0 0 0 1px var(--border)" };
  return <span className={`inline-flex items-center justify-center rounded-full px-0.5 font-extrabold leading-none ${dim} ${state === "READY" ? "pulse-soft" : ""}`} style={style}>{name.trim().charAt(0).toUpperCase()}</span>;
}

/** Frise des suites d'une table : où en sont les clients (entrées servies, plats en cuisine, desserts à venir…). */
export function MealSteps({ meal, compact = false, className = "" }: { meal: MealStage; compact?: boolean; className?: string }) {
  if (!meal.steps.length) return null;
  const title = meal.steps.map((s) => `${courseLabel(s.name)} : ${COURSE_STATE_LABEL[s.state]}`).join(" · ");
  if (compact) {
    return (
      <span className={`flex items-center gap-0.5 rounded-full bg-[var(--surface)] px-1 py-0.5 shadow-lift ring-1 ring-[var(--border)] ${className}`} title={title} data-testid="meal-steps" aria-label={title}>
        {meal.steps.map((s, i) => <StepDot key={i} name={s.name} state={s.state} />)}
      </span>
    );
  }
  // Carte (téléphone) : pastilles puis l'étape en cours en toutes lettres
  return (
    <span className={`flex items-center gap-1.5 ${className}`} title={title} data-testid="meal-steps">
      <span className="flex items-center gap-0.5">{meal.steps.map((s, i) => <StepDot key={i} name={s.name} state={s.state} size="md" />)}</span>
      <span className="truncate text-[11px] font-bold" style={meal.current ? { color: courseColor(meal.current.name) } : undefined}>{meal.current ? `${courseLabel(meal.current.name)} · ${COURSE_STATE_LABEL[meal.current.state]}` : "à envoyer"}</span>
    </span>
  );
}
