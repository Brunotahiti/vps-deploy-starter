import { randomBytes } from "node:crypto";

/** Texte inséré dans une page HTML : jamais interprété comme du balisage. */
export const escapeHtml = (s: string | number | null | undefined) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Page imprimable (ticket, bon cuisine, rapport de caisse) servie avec une politique de sécurité stricte : seuls ses
 * propres scripts (bouton Imprimer, impression automatique) s'exécutent, même si un texte saisi contenait du balisage.
 */
export function printableHtml(html: string) {
  const nonce = randomBytes(16).toString("base64");
  const body = html
    .replaceAll(`onclick="window.print()"`, "data-print")
    .replaceAll("<script>", `<script nonce="${nonce}">`)
    .replace("</body>", `<script nonce="${nonce}">document.querySelectorAll("[data-print]").forEach((b)=>b.addEventListener("click",()=>window.print()))</script></body>`);
  return new Response(body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data: https:; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
