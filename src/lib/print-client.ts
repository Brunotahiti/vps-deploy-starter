/** Résultat d'une impression ou d'une ouverture de tiroir renvoyé par le serveur, quel que soit le pilote. */
export type PrintResult = { delivered: boolean; queued?: boolean; warning?: string; error?: string; agentUrl?: string; payloadBase64?: string };

/** Relais navigateur → agent d'impression local (pilote « agent »). */
async function relay(r: PrintResult) {
  if (!r.agentUrl || !r.payloadBase64) return false;
  try { await fetch(r.agentUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payloadBase64: r.payloadBase64 }) }); return true; } catch { return false; }
}

/** Termine l'envoi si besoin (agent local) et affiche un retour lisible. */
export async function reportPrint(r: PrintResult, toast: (m: string, kind?: "success" | "error" | "info") => void, what = "Ticket") {
  if (r.delivered) return toast(`${what} : envoyé à l'imprimante`, "success");
  if (r.queued) return toast(r.warning ?? `${what} : transmis, l'imprimante le récupère dans quelques secondes`, r.warning ? "info" : "success");
  if (r.agentUrl) return (await relay(r)) ? toast(`${what} : transmis à l'agent d'impression`, "success") : toast("Agent d'impression injoignable depuis cet appareil", "error");
  toast(r.error ?? "Impression impossible", "error");
}
