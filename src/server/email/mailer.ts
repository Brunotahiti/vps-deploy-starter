import nodemailer, { type Transporter } from "nodemailer";

/**
 * Envoi d'e-mails. Transport SMTP (variables SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS,
 * SMTP_SECURE, SMTP_FROM). En test : EMAIL_TRANSPORT=memory conserve les messages en mémoire.
 * Conçu pour brancher d'autres prestataires (API HTTP) sans toucher aux appels.
 */
export type OutgoingMail = { to: string; subject: string; text: string; html: string; attachments?: { filename: string; content: Buffer; contentType: string }[] };

export const sentMails: OutgoingMail[] = []; // transport mémoire (tests)

export function isEmailConfigured(): boolean {
  return process.env.EMAIL_TRANSPORT === "memory" || !!process.env.SMTP_HOST;
}

let transporter: Transporter | null = null;
function getTransporter(): Transporter {
  if (transporter) return transporter;
  const port = Number(process.env.SMTP_PORT ?? 587);
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" } : undefined,
  });
  return transporter;
}

export async function sendMail(mail: OutgoingMail): Promise<{ id: string }> {
  if (process.env.EMAIL_TRANSPORT === "memory") {
    sentMails.push(mail);
    return { id: `memory-${sentMails.length}` };
  }
  if (!process.env.SMTP_HOST) throw new Error("EMAIL_NOT_CONFIGURED");
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || "manaresto@localhost";
  const info = await getTransporter().sendMail({ from, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html, attachments: mail.attachments });
  return { id: String(info.messageId ?? "") };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Corps HTML d'un e-mail de reçu, aux couleurs ManaResto, avec le PDF en pièce jointe. */
export function receiptMail(input: { to: string; establishmentName: string; orderNumber: string; total: string; dateLabel: string; pdf: Buffer; isPaid: boolean; phone?: string | null; address?: string | null }): OutgoingMail {
  const title = input.isPaid ? "Votre reçu" : "Votre addition";
  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#f3f5f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 6px 20px -8px rgba(15,23,42,.15)">
<tr><td style="background:linear-gradient(135deg,#14aaa3,#0f6e6c);padding:28px 28px 24px;color:#fff">
<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.85">${esc(input.establishmentName)}</div>
<div style="font-size:24px;font-weight:800;margin-top:6px">${title}</div>
<div style="font-size:13px;opacity:.9;margin-top:4px">N° ${esc(input.orderNumber)} · ${esc(input.dateLabel)}</div></td></tr>
<tr><td style="padding:24px 28px">
<p style="margin:0 0 14px;font-size:15px;line-height:1.5">Bonjour,<br>merci de votre visite chez <strong>${esc(input.establishmentName)}</strong>. Vous trouverez ${input.isPaid ? "votre reçu" : "votre addition"} en pièce jointe (PDF).</p>
<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;background:#f1f4f8;border-radius:14px"><tr><td style="padding:16px 18px;font-size:13px;color:#64748b">Montant ${input.isPaid ? "réglé" : "à régler"}</td><td style="padding:16px 18px;text-align:right;font-size:22px;font-weight:800;color:#0f6e6c">${esc(input.total)}</td></tr></table>
${input.address || input.phone ? `<p style="margin:18px 0 0;font-size:12px;color:#64748b;line-height:1.5">${esc(input.establishmentName)}${input.address ? `<br>${esc(input.address)}` : ""}${input.phone ? `<br>Tél. ${esc(input.phone)}` : ""}</p>` : ""}
<p style="margin:22px 0 0;font-size:14px">À bientôt · <em>Māuruuru</em></p></td></tr>
<tr><td style="padding:14px 28px;background:#f8fafc;font-size:11px;color:#94a3b8;text-align:center">Reçu envoyé par ManaResto pour ${esc(input.establishmentName)}. Ne pas répondre à cet e-mail automatique.</td></tr>
</table></td></tr></table></body></html>`;
  const text = `${title} — ${input.establishmentName}\nN° ${input.orderNumber} · ${input.dateLabel}\nMontant ${input.isPaid ? "réglé" : "à régler"} : ${input.total}\n\nLe document PDF est en pièce jointe. Merci de votre visite, māuruuru !`;
  return { to: input.to, subject: `${title} ${input.orderNumber} — ${input.establishmentName}`, text, html, attachments: [{ filename: `recu-${input.orderNumber}.pdf`, content: input.pdf, contentType: "application/pdf" }] };
}
