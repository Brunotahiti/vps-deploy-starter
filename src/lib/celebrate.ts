/**
 * Petite célébration : une pluie de confettis d'une seconde et demie (commande soldée, objectif atteint, mise en route
 * terminée). Sans bibliothèque ni état React ; rien si l'appareil demande moins d'animations.
 */
const COLORS = ["#14aaa3", "#f97c3c", "#facc15", "#e87ba4", "#4a3aa7", "#22c55e"];

export function celebrate(opts: { count?: number; origin?: { x: number; y: number } } = {}) {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const count = opts.count ?? 70;
  const ox = opts.origin?.x ?? 0.5, oy = opts.origin?.y ?? 0.35;
  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:hidden";
  document.body.appendChild(layer);
  const w = window.innerWidth, h = window.innerHeight;
  for (let i = 0; i < count; i++) {
    const piece = document.createElement("span");
    const size = 6 + Math.random() * 7;
    const round = Math.random() < 0.35;
    piece.style.cssText = `position:absolute;left:${ox * w}px;top:${oy * h}px;width:${size}px;height:${round ? size : size * 0.45}px;background:${COLORS[i % COLORS.length]};border-radius:${round ? "50%" : "2px"};will-change:transform,opacity`;
    layer.appendChild(piece);
    const angle = Math.random() * Math.PI * 2;
    const speed = 160 + Math.random() * 260;
    const dx = Math.cos(angle) * speed, dy = Math.sin(angle) * speed - 160;
    const spin = (Math.random() - 0.5) * 720;
    piece.animate(
      [
        { transform: "translate(-50%, -50%) rotate(0deg)", opacity: 1 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${spin / 2}deg)`, opacity: 1, offset: 0.45 },
        { transform: `translate(calc(-50% + ${dx * 1.3}px), calc(-50% + ${dy + 420}px)) rotate(${spin}deg)`, opacity: 0 },
      ],
      { duration: 1300 + Math.random() * 500, easing: "cubic-bezier(.2,.7,.3,1)", fill: "forwards" },
    );
  }
  setTimeout(() => layer.remove(), 2000);
}
