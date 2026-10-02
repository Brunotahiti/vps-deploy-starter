/**
 * État d'authentification hors ligne lu par le client HTTP au moment de chaque requête (accès synchrone) :
 * laissez-passer de l'employé connecté, et autorisation manager donnée hors ligne pour l'opération en cours.
 */
export type ActivePass = {
  token: string;
  userId: string;
  firstName: string;
  lastName: string;
  displayName: string | null;
  color: string | null;
  isOwner: boolean;
  roleKey: string | null;
  permissions: string[];
  expiresAt: string;
  /** "offline" : connexion faite sans internet (le laissez-passer authentifie toutes les requêtes) ;
   *  "online" : session normale, le laissez-passer signe seulement les opérations mises en file. */
  mode: "online" | "offline";
};

export const PASS_HEADER = "X-Offline-Pass";
export const MANAGER_HEADER = "X-Offline-Manager";

let active: ActivePass | null = null;
let knownPermissions: string[] = [];
let scoped: { managerPass?: string; forceQueue?: boolean } | null = null;

/**
 * Mode hors ligne (option « Continuité de service ») : sans elle, une opération sans réseau échoue au lieu
 * d'être mise en file. Gardé sur l'appareil pour s'appliquer aussi au démarrage sans internet.
 */
const OFFLINE_KEY = "manaresto:offline-allowed";
let offlineFlag: boolean | null = null;
export function offlineAllowed(): boolean {
  if (offlineFlag === null) { try { offlineFlag = typeof localStorage === "undefined" || localStorage.getItem(OFFLINE_KEY) !== "0"; } catch { offlineFlag = true; } }
  return offlineFlag;
}
export function setOfflineAllowed(allowed: boolean) {
  offlineFlag = allowed;
  try { localStorage.setItem(OFFLINE_KEY, allowed ? "1" : "0"); } catch { /* stockage indisponible : réglage en mémoire */ }
}
export const OFFLINE_OPTION_MESSAGE = "Pas de connexion internet. Avec l'option « Continuité de service », la caisse continue sans internet.";

export const getActivePass = () => active;
export const setActivePassState = (p: ActivePass | null) => { active = p; };
export const setKnownPermissions = (perms: string[]) => { knownPermissions = perms; };

/** Droits de l'employé connecté, connus sans réseau. */
export function localCan(permission: string) {
  const perms = active ? active.permissions : knownPermissions;
  return perms.includes("*") || perms.includes(permission);
}

/** En-têtes ajoutés à une requête partant maintenant. */
export function liveHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  if (active?.mode === "offline") h[PASS_HEADER] = active.token;
  if (scoped?.managerPass) h[MANAGER_HEADER] = scoped.managerPass;
  return h;
}

/** En-têtes gardés avec une opération mise en file : elle sera rejouée au nom de qui l'a saisie. */
export function queuedHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  if (active) h[PASS_HEADER] = active.token;
  if (scoped?.managerPass) h[MANAGER_HEADER] = scoped.managerPass;
  return h;
}

export const forceQueue = () => !!scoped?.forceQueue;

/**
 * Exécute `fn` (qui lance ses requêtes immédiatement) avec une autorisation hors ligne : mise en file forcée
 * et, le cas échéant, laissez-passer du manager qui a saisi son PIN.
 */
export function withOfflineAuth<T>(opts: { managerPass?: string; forceQueue?: boolean }, fn: () => Promise<T>): Promise<T> {
  const prev = scoped;
  scoped = opts;
  try { return fn(); } finally { scoped = prev; }
}
