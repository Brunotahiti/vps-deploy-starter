/** Résultat d'une impression ou d'une ouverture de tiroir renvoyé par le serveur, quel que soit le pilote. */
export type PrintResult = { delivered: boolean; queued?: boolean; warning?: string; error?: string; agentUrl?: string; agentTarget?: { host: string; port: number }; payloadBase64?: string };

/** Relais navigateur → agent d'impression du restaurant (pilote « agent ») ; l'imprimante Wi-Fi visée voyage avec le ticket. */
async function relay(r: PrintResult) {
  if (!r.agentUrl || !r.payloadBase64) return false;
  try {
    const res = await fetch(r.agentUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payloadBase64: r.payloadBase64, ...(r.agentTarget ?? {}) }), signal: AbortSignal.timeout?.(8000) });
    return res.ok;
  } catch { return false; }
}

/** Termine l'envoi si besoin (agent local) et affiche un retour lisible. */
export async function reportPrint(r: PrintResult, toast: (m: string, kind?: "success" | "error" | "info") => void, what = "Ticket") {
  if (r.delivered) return toast(`${what} : envoyé à l'imprimante`, "success");
  if (r.queued) return toast(r.warning ?? `${what} : transmis, l'imprimante le récupère dans quelques secondes`, r.warning ? "info" : "success");
  if (r.agentUrl) return (await relay(r)) ? toast(`${what} : envoyé à l'imprimante`, "success") : toast("Agent d'impression injoignable depuis cet appareil, ou imprimante éteinte", "error");
  toast(r.error ?? "Impression impossible", "error");
}
