/**
 * Conflit hors ligne : une table ouverte sans réseau sur cet appareil a, entre-temps, été ouverte sur un autre.
 * Le serveur n'accepte qu'une commande par table et renvoie la commande existante : les opérations suivantes
 * de la file (articles, envois en cuisine…) visent alors un identifiant inconnu et seraient refusées.
 * On les redirige vers la commande existante — suites comprises — pour ne perdre aucun article saisi.
 */
import type { OutboxEntry } from "./db";

export type Aliases = Record<string, string>;
type Course = { id: string; name: string; sortOrder?: number };

/** Suites locales → suites de la commande existante : même nom d'abord, sinon même rang, sinon la première. */
export function courseAliases(local: Course[], server: Course[]): Aliases {
  if (!server.length) return {};
  const sorted = [...server].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const out: Aliases = {};
  local.forEach((c, i) => {
    const byName = sorted.find((s) => s.name.trim().toLowerCase() === c.name.trim().toLowerCase());
    out[c.id] = (byName ?? sorted[i] ?? sorted[0]).id;
  });
  return out;
}

/** Remplace les identifiants redirigés dans l'adresse et le contenu d'une opération en attente. */
export function rewriteEntry(entry: OutboxEntry, aliases: Aliases): OutboxEntry {
  const pairs = Object.entries(aliases).filter(([from, to]) => from && to && from !== to);
  if (!pairs.length) return entry;
  const swap = (s: string) => pairs.reduce((acc, [from, to]) => acc.split(from).join(to), s);
  const url = swap(entry.url);
  const body = entry.body === undefined ? undefined : JSON.parse(swap(JSON.stringify(entry.body)));
  return url === entry.url && JSON.stringify(body) === JSON.stringify(entry.body) ? entry : { ...entry, url, body };
}

/**
 * Après la création d'une commande : si le serveur a renvoyé une autre commande (table déjà ouverte ailleurs),
 * renvoie les redirections à appliquer à la suite de la file, sinon null.
 */
export function aliasesForCreatedOrder(sent: { id?: string; courses?: Course[] } | undefined, received: { id: string; courses?: Course[] } | null | undefined): Aliases | null {
  if (!sent?.id || !received?.id || sent.id === received.id) return null;
  return { [sent.id]: received.id, ...courseAliases(sent.courses ?? [], received.courses ?? []) };
}
