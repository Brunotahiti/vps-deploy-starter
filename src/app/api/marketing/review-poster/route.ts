import { route } from "@/server/http";
import { requireMarketing } from "@/server/marketing-auth";
import { ApiError } from "@/server/errors";
import { reviewSettings } from "@/server/services/marketing";
import { escapeHtml as esc, printableHtml } from "@/server/html";

/** Affichette « Votre avis compte » avec le QR code du lien d'avis, à poser sur les tables ou au comptoir. */
export const GET = route(async () => {
  const ctx = await requireMarketing("manage");
  const { reviewUrl } = await reviewSettings(ctx.establishment.id);
  if (!reviewUrl) throw new ApiError(409, "NO_REVIEW_URL", "Renseignez d'abord le lien de votre fiche d'avis");
  const QRCode = (await import("qrcode")).default;
  const svg = await QRCode.toString(reviewUrl, { type: "svg", margin: 1, width: 360, color: { dark: "#0f172a", light: "#ffffff" } });
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Votre avis compte — ${esc(ctx.establishment.name)}</title>
<style>@page{size:A5;margin:0}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f3f5f8}.p{width:148mm;min-height:210mm;margin:16px auto;box-sizing:border-box;background:#fff;border-radius:16px;padding:16mm 12mm;text-align:center}.k{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#0d8a86;font-weight:700}h1{font-size:30px;margin:6px 0 4px}.s{color:#475569;font-size:15px;margin:0 0 10mm}.q{width:70mm;height:70mm;margin:0 auto}.q svg{width:100%;height:100%}.stars{font-size:28px;color:#f59e0b;margin-top:8mm}.n{margin-top:6mm;font-weight:800;font-size:18px}.btn{display:block;margin:12px auto;padding:10px 16px;background:#0ea5a4;color:#fff;border:0;border-radius:8px;font-size:14px}@media print{.btn{display:none}body{background:#fff}.p{margin:0;border-radius:0}}</style></head><body>
<div class="p"><div class="k">${esc(ctx.establishment.name)}</div><h1>Votre avis compte</h1><p class="s">Un repas réussi ? Dites-le en 30 secondes : scannez le code avec votre téléphone.</p>
<div class="q">${svg}</div><div class="stars">★★★★★</div><div class="n">Māuruuru !</div></div>
<button class="btn" onclick="window.print()">Imprimer l'affichette</button></body></html>`;
  return printableHtml(html);
});
