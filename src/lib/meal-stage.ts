/**
 * Où en est une table dans son repas : une étape par suite commandée (apéritifs, entrées, plats, desserts…),
 * avec son état — à envoyer, en cuisine, prêt, servi — et la suite en cours.
 */
export type CourseState = "PENDING" | "COOKING" | "READY" | "SERVED";
export type MealStep = { name: string; state: CourseState };
export type MealStage = { steps: MealStep[]; current: MealStep | null };

type ItemLike = { courseId: string | null; status: string; parentItemId?: string | null };
type CourseLike = { id: string; name: string; sortOrder: number };

/** État d'une suite d'après ses articles : tout servi → servi ; un plat prêt → prêt ; parti en cuisine → en cuisine ; sinon à envoyer. */
function courseState(statuses: string[]): CourseState {
  if (statuses.every((s) => s === "SERVED")) return "SERVED";
  if (statuses.some((s) => s === "READY")) return "READY";
  if (statuses.some((s) => s === "SENT" || s === "PREPARING")) return "COOKING";
  if (statuses.some((s) => s === "SERVED")) return "COOKING"; // une partie déjà servie, le reste pas encore parti
  return "PENDING";
}

export function mealStage(courses: CourseLike[], items: ItemLike[]): MealStage {
  const active = items.filter((i) => i.status !== "VOIDED" && !i.parentItemId && i.courseId);
  const steps = [...courses]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((c) => ({ name: c.name, statuses: active.filter((i) => i.courseId === c.id).map((i) => i.status) }))
    .filter((c) => c.statuses.length > 0)
    .map((c) => ({ name: c.name, state: courseState(c.statuses) }));
  // Suite en cours : la plus avancée déjà lancée (en cuisine, prête ou servie) ; sinon aucune (commande en cours de saisie)
  const started = steps.filter((s) => s.state !== "PENDING");
  const current = started.find((s) => s.state === "READY") ?? started.find((s) => s.state === "COOKING") ?? started[started.length - 1] ?? null;
  return { steps, current };
}

/** Libellé court d'une suite : « APÉRITIFS » → « Apéritifs ». */
export const courseLabel = (name: string) => name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();

/** Couleur d'une suite, alignée sur celles des catégories de la carte (entrées vertes, plats orange, desserts roses). */
export function courseColor(name: string) {
  const n = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (/aperit|boisson|bar/.test(n)) return "#0ea5e9";
  if (/entree|starter/.test(n)) return "#22c55e";
  if (/plat|main/.test(n)) return "#f97316";
  if (/dessert/.test(n)) return "#ec4899";
  return "#64748b";
}

export const COURSE_STATE_LABEL: Record<CourseState, string> = { PENDING: "à envoyer", COOKING: "en cuisine", READY: "prêt", SERVED: "servi" };
