import type { ComponentType } from "react";
import { BellRing, ChefHat, ConciergeBell, Flame, Layers, LayoutGrid, ListChecks, PencilLine, Printer, Receipt, Smartphone, Timer, Wallet, type LucideProps } from "lucide-react";

export type PortalMode = "salle" | "commande" | "caisse" | "cuisine";

type Icon = ComponentType<LucideProps>;
type PortalConfig = {
  label: string;
  path: string;
  next: string;
  permission: string;
  icon: Icon;
  title: string;
  submit: string;
  terminalKind: string;
  greeting: (hour: number) => string;
  features: { icon: Icon; tone: string; text: string }[];
  // Classes complètes (Tailwind ne génère que les noms écrits en entier)
  accentText: string;
  glow: string;
  tile: string;
  button: string;
  dot: string;
  tab: string;
};

/** Les portails du personnel : même gestuelle, une couleur et un écran d'arrivée par équipe. */
export const PORTALS: Record<PortalMode, PortalConfig> = {
  salle: {
    label: "Salle", path: "/salle", next: "/pos", permission: "pos.use", icon: ConciergeBell,
    title: "Prendre le service", submit: "Prendre le service", terminalKind: "Caisse",
    greeting: (h) => (h < 10 ? "Belle mise en place" : h < 15 ? "Bon service du midi" : h < 18 ? "Bel après-midi en salle" : "Bon service du soir"),
    features: [
      { icon: LayoutGrid, tone: "text-lagon-300", text: "Le plan de salle en direct : tables libres, occupées, addition demandée" },
      { icon: Layers, tone: "text-sky-300", text: "Envoi en cuisine suite par suite, au bon rythme" },
      { icon: ListChecks, tone: "text-emerald-300", text: "« À faire maintenant » : les tables qui attendent quelque chose" },
    ],
    accentText: "text-lagon-300", glow: "bg-lagon-400/25", tile: "from-lagon-400 to-lagon-600 shadow-[0_10px_30px_-10px_rgb(20_170_163/0.8)]",
    button: "from-lagon-500 to-lagon-600 shadow-[0_14px_34px_-12px_rgb(20_170_163/0.9)]", dot: "bg-lagon-300 shadow-[0_0_14px_rgb(55_200_191/0.7)]", tab: "bg-lagon-500",
  },
  commande: {
    label: "Commande", path: "/commande", next: "/pos/m", permission: "pos.use", icon: Smartphone,
    title: "Prendre les commandes", submit: "Prendre les commandes", terminalKind: "Caisse",
    greeting: (h) => (h < 10 ? "Belle mise en place" : h < 15 ? "Bon service du midi" : h < 18 ? "Bel après-midi en salle" : "Bon service du soir"),
    features: [
      { icon: Smartphone, tone: "text-sky-300", text: "La carte dans la poche : on commande à la table, en quelques gestes" },
      { icon: BellRing, tone: "text-emerald-300", text: "Prévenu dès qu'un plat est prêt en cuisine" },
      { icon: PencilLine, tone: "text-amber-300", text: "Modifications et annulations transmises à la cuisine, avec leur suivi" },
    ],
    accentText: "text-sky-300", glow: "bg-sky-400/25", tile: "from-sky-400 to-blue-600 shadow-[0_10px_30px_-10px_rgb(56_189_248/0.8)]",
    button: "from-sky-500 to-blue-600 shadow-[0_14px_34px_-12px_rgb(56_189_248/0.9)]", dot: "bg-sky-300 shadow-[0_0_14px_rgb(125_211_252/0.7)]", tab: "bg-sky-500",
  },
  caisse: {
    label: "Caisse", path: "/pos/login", next: "/pos/orders", permission: "pos.use", icon: Wallet,
    title: "Ouvrir la caisse", submit: "Ouvrir la caisse", terminalKind: "Caisse",
    greeting: (h) => (h < 10 ? "Belle ouverture" : h < 15 ? "Bon service du midi" : h < 18 ? "Bel après-midi" : "Bonne soirée"),
    features: [
      { icon: Wallet, tone: "text-amber-300", text: "Espèces, carte ou addition partagée entre convives" },
      { icon: Printer, tone: "text-sky-300", text: "Ticket imprimé, en PDF ou envoyé par e-mail au client" },
      { icon: Receipt, tone: "text-emerald-300", text: "Clôture de caisse avec l'écart calculé automatiquement" },
    ],
    accentText: "text-amber-300", glow: "bg-amber-400/20", tile: "from-amber-400 to-amber-600 shadow-[0_10px_30px_-10px_rgb(245_158_11/0.8)]",
    button: "from-amber-500 to-amber-600 shadow-[0_14px_34px_-12px_rgb(245_158_11/0.9)]", dot: "bg-amber-300 shadow-[0_0_14px_rgb(252_211_77/0.7)]", tab: "bg-amber-500",
  },
  cuisine: {
    label: "Cuisine", path: "/kds/login", next: "/kds", permission: "kds.use", icon: ChefHat,
    title: "Entrer en cuisine", submit: "Entrer en cuisine", terminalKind: "Écran cuisine",
    greeting: (h) => (h < 10 ? "Bonne mise en place" : h < 15 ? "Bon coup de feu du midi" : h < 18 ? "Bonne préparation du soir" : "Bon service du soir"),
    features: [
      { icon: BellRing, tone: "text-lagon-300", text: "Un bip à chaque nouveau bon envoyé par la salle" },
      { icon: Timer, tone: "text-amber-300", text: "Les tickets changent de couleur quand l'attente s'allonge" },
      { icon: Flame, tone: "text-corail-400", text: "Les plats urgents passent en tête" },
    ],
    accentText: "text-corail-400", glow: "bg-corail-500/25", tile: "from-corail-400 to-corail-600 shadow-[0_10px_30px_-10px_rgb(249_124_60/0.8)]",
    button: "from-corail-500 to-corail-600 shadow-[0_14px_34px_-12px_rgb(249_124_60/0.9)]", dot: "bg-corail-400 shadow-[0_0_14px_rgb(249_124_60/0.7)]", tab: "bg-corail-500",
  },
};

const PORTAL_KEY = "mr-portal";

/** Dernier portail choisi sur cet appareil (la tablette du serveur revient sur « Salle » après déconnexion). */
export function rememberedPortal(): PortalMode | null {
  try { const v = localStorage.getItem(PORTAL_KEY); return v === "salle" || v === "commande" || v === "caisse" || v === "cuisine" ? v : null; } catch { return null; }
}
export function rememberPortal(mode: PortalMode) {
  try { localStorage.setItem(PORTAL_KEY, mode); } catch { /* stockage indisponible */ }
}
