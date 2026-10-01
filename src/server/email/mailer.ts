import nodemailer, { type Transporter } from "nodemailer";

/**
 * Envoi d'e-mails. Transport SMTP (variables SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS,
 * SMTP_SECURE, SMTP_FROM). En test : EMAIL_TRANSPORT=memory conserve les messages en mémoire.
 * Conçu pour brancher d'autres prestataires (API HTTP) sans toucher aux appels.
 */
export type OutgoingMail = { to: string; subject: string; text: string; html: string; replyTo?: string; attachments?: { filename: string; content: Buffer; contentType: string }[] };

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
  const info = await getTransporter().sendMail({ from, to: mail.to, replyTo: mail.replyTo, subject: mail.subject, text: mail.text, html: mail.html, attachments: mail.attachments });
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

/** E-mail d'invitation à rejoindre l'équipe : bouton vers la page de création du mot de passe. */
export function invitationMail(input: { to: string; firstName: string; organizationName: string; establishments: string[]; inviterName: string; url: string; expiresDays: number }): OutgoingMail {
  const where = input.establishments.length ? input.establishments.join(", ") : input.organizationName;
  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#f3f5f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 6px 20px -8px rgba(15,23,42,.15)">
<tr><td style="background:linear-gradient(135deg,#14aaa3,#0f6e6c);padding:28px 28px 24px;color:#fff">
<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.85">ManaResto · ${esc(input.organizationName)}</div>
<div style="font-size:24px;font-weight:800;margin-top:6px">Bienvenue dans l'équipe, ${esc(input.firstName)} !</div></td></tr>
<tr><td style="padding:24px 28px">
<p style="margin:0 0 14px;font-size:15px;line-height:1.5"><strong>${esc(input.inviterName)}</strong> vous invite à rejoindre <strong>${esc(where)}</strong> sur ManaResto, l'application de caisse et de gestion du restaurant.</p>
<p style="margin:0 0 20px;font-size:15px;line-height:1.5">Cliquez sur le bouton pour choisir votre mot de passe et votre code PIN de caisse. Vous pourrez ensuite vous connecter sur tablette, téléphone ou ordinateur.</p>
<p style="margin:0 0 20px;text-align:center"><a href="${esc(input.url)}" style="display:inline-block;background:#f97c3c;color:#fff;text-decoration:none;font-weight:800;font-size:16px;padding:14px 26px;border-radius:14px">Créer mon accès</a></p>
<p style="margin:0;font-size:12px;color:#64748b;line-height:1.5">Ce lien est valable ${input.expiresDays} jours. Si le bouton ne fonctionne pas, copiez cette adresse dans votre navigateur :<br><a href="${esc(input.url)}" style="color:#0f6e6c;word-break:break-all">${esc(input.url)}</a></p></td></tr>
<tr><td style="padding:14px 28px;background:#f8fafc;font-size:11px;color:#94a3b8;text-align:center">Invitation envoyée par ManaResto pour ${esc(input.organizationName)}. Si vous n'attendiez pas cette invitation, ignorez cet e-mail.</td></tr>
</table></td></tr></table></body></html>`;
  const text = `Bienvenue dans l'équipe, ${input.firstName} !\n\n${input.inviterName} vous invite à rejoindre ${where} sur ManaResto.\nCréez votre accès (mot de passe et PIN de caisse) : ${input.url}\n\nCe lien est valable ${input.expiresDays} jours.`;
  return { to: input.to, subject: `${input.inviterName} vous invite à rejoindre ${where} sur ManaResto`, text, html };
}

/** E-mail interne : nouvelle demande de démonstration depuis le site vitrine. */
export function demoRequestMail(input: { to: string; restaurantName: string; contactName: string; phone: string; email: string; commune: string; kind: string; message?: string | null; consoleUrl?: string }): OutgoingMail {
  const rows: [string, string][] = [["Établissement", input.restaurantName], ["Type", input.kind], ["Contact", input.contactName], ["Téléphone", input.phone], ["E-mail", input.email], ["Commune", input.commune]];
  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#f3f5f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#fff;border-radius:20px;overflow:hidden">
<tr><td style="background:linear-gradient(135deg,#14aaa3,#0f6e6c);padding:24px 28px;color:#fff"><div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.85">ManaResto · site vitrine</div><div style="font-size:22px;font-weight:800;margin-top:6px">Nouvelle demande de démonstration</div></td></tr>
<tr><td style="padding:22px 28px"><table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;font-size:14px">${rows.map(([k, v]) => `<tr><td style="padding:6px 0;color:#64748b;width:38%">${esc(k)}</td><td style="padding:6px 0;font-weight:700">${esc(v)}</td></tr>`).join("")}</table>
${input.message ? `<p style="margin:16px 0 0;font-size:14px;line-height:1.5;white-space:pre-wrap"><b>Message :</b><br>${esc(input.message)}</p>` : ""}
<p style="margin:18px 0 0;font-size:13px"><a href="tel:${esc(input.phone.replace(/[^+\d]/g, ""))}" style="color:#0f6e6c">Appeler</a> · <a href="mailto:${esc(input.email)}" style="color:#0f6e6c">Répondre par e-mail</a>${input.consoleUrl ? ` · <a href="${esc(input.consoleUrl)}" style="color:#0f6e6c">Ouvrir la console</a>` : ""}</p></td></tr>
</table></td></tr></table></body></html>`;
  const text = `Nouvelle demande de démonstration\n\n${rows.map(([k, v]) => `${k} : ${v}`).join("\n")}${input.message ? `\n\nMessage :\n${input.message}` : ""}`;
  return { to: input.to, subject: `Démo ManaResto — ${input.restaurantName} (${input.commune})`, text, html, replyTo: input.email };
}

/**
 * E-mail de la plateforme ManaResto vers un restaurateur (bienvenue, fin d'essai, message du support).
 * Paragraphes en texte brut (échappés), bouton d'action facultatif, réponse vers l'adresse de contact.
 */
/**
 * Encadré mis en évidence (bleu nuit, bouton turquoise, distinct du bouton orange principal) : la démonstration
 * avec un compte exemple. Tableaux et styles en ligne pour les messageries (Gmail, Outlook, Mail).
 */
function showcaseHtml(b: { kicker: string; title: string; text: string; points: string[]; label: string; url: string; note?: string }) {
  const points = b.points.map((pt) => `<tr><td valign="top" style="padding:0 8px 6px 0;color:#2dd4bf;font-size:15px;line-height:1.45">✓</td><td style="padding:0 0 6px;color:#e2e8f0;font-size:14px;line-height:1.45">${esc(pt)}</td></tr>`).join("");
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:4px 0 22px;border-collapse:separate"><tr><td style="background:#0b2a3c;border-radius:18px;padding:22px 22px 20px;color:#fff">
<div style="font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#2dd4bf">${esc(b.kicker)}</div>
<div style="font-size:20px;font-weight:800;line-height:1.3;margin:6px 0 10px;color:#fff">${esc(b.title)}</div>
<p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#cbd5e1">${esc(b.text)}</p>
<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 16px">${points}</table>
<p style="margin:0;text-align:center"><a href="${esc(b.url)}" style="display:inline-block;background:#2dd4bf;color:#042f2e;text-decoration:none;font-weight:800;font-size:16px;padding:14px 24px;border-radius:14px">${esc(b.label)}</a></p>
${b.note ? `<p style="margin:10px 0 0;text-align:center;font-size:12px;line-height:1.45;color:#94a3b8">${esc(b.note)}</p>` : ""}
</td></tr></table>`;
}

export function platformMail(input: { to: string; subject: string; kicker: string; title: string; paragraphs: string[]; cta?: { label: string; url: string }; showcase?: { kicker: string; title: string; text: string; points: string[]; label: string; url: string; note?: string }; secondary?: { label: string; url: string; note?: string }[]; hero?: { src: string; alt: string; width: number; height: number; href?: string }; replyTo: string; footer: string }): OutgoingMail {
  const paras = input.paragraphs.map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55">${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#f3f5f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:540px;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 6px 20px -8px rgba(15,23,42,.15)">
${input.hero ? `<tr><td style="padding:0;line-height:0;font-size:0">${input.hero.href ? `<a href="${esc(input.hero.href)}">` : ""}<img src="${esc(input.hero.src)}" alt="${esc(input.hero.alt)}" width="540" height="${Math.round((540 * input.hero.height) / input.hero.width)}" style="display:block;width:100%;max-width:540px;height:auto;border:0;background:#14aaa3;color:#fff;font-size:16px;line-height:1.3">${input.hero.href ? "</a>" : ""}</td></tr>` : ""}
<tr><td style="background:linear-gradient(135deg,#14aaa3,#0f6e6c);padding:28px 28px 24px;color:#fff">
<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.85">${esc(input.kicker)}</div>
<div style="font-size:24px;font-weight:800;margin-top:6px;line-height:1.25">${esc(input.title)}</div></td></tr>
<tr><td style="padding:24px 28px 10px">${paras}
${input.cta ? `<p style="margin:6px 0 20px;text-align:center"><a href="${esc(input.cta.url)}" style="display:inline-block;background:#f97c3c;color:#fff;text-decoration:none;font-weight:800;font-size:16px;padding:14px 26px;border-radius:14px">${esc(input.cta.label)}</a></p>` : ""}
${input.showcase ? showcaseHtml(input.showcase) : ""}
${(input.secondary ?? []).map((b) => `<p style="margin:0 0 ${b.note ? "6" : "14"}px;text-align:center"><a href="${esc(b.url)}" style="display:inline-block;background:#e6f7f6;color:#0f6e6c;text-decoration:none;font-weight:800;font-size:15px;padding:12px 22px;border-radius:14px">${esc(b.label)}</a></p>${b.note ? `<p style="margin:0 0 16px;text-align:center;font-size:12px;color:#64748b">${esc(b.note)}</p>` : ""}`).join("")}
<p style="margin:0 0 18px;font-size:14px">Māuruuru,<br><strong>L'équipe ManaResto</strong><br><a href="mailto:${esc(input.replyTo)}" style="color:#0f6e6c">${esc(input.replyTo)}</a></p></td></tr>
<tr><td style="padding:14px 28px;background:#f8fafc;font-size:11px;color:#94a3b8;text-align:center">${esc(input.footer)}</td></tr>
</table></td></tr></table></body></html>`;
  const text = `${input.title}\n\n${input.paragraphs.join("\n\n")}${input.cta ? `\n\n${input.cta.label} : ${input.cta.url}` : ""}${input.showcase ? `\n\n— ${input.showcase.title} —\n${input.showcase.text}\n${input.showcase.points.map((pt) => `• ${pt}`).join("\n")}\n${input.showcase.label} : ${input.showcase.url}${input.showcase.note ? `\n(${input.showcase.note})` : ""}` : ""}${(input.secondary ?? []).map((b) => `\n\n${b.label} : ${b.url}${b.note ? `\n(${b.note})` : ""}`).join("")}\n\nMāuruuru,\nL'équipe ManaResto — ${input.replyTo}`;
  return { to: input.to, subject: input.subject, text, html, replyTo: input.replyTo };
}

/** E-mail interne : un nouveau restaurant vient de créer son compte (essai gratuit). */
export function signupAlertMail(input: { to: string; organizationName: string; establishmentName: string; ownerName: string; email: string; trialEndsLabel: string; consoleUrl: string; total: number }): OutgoingMail {
  const rows: [string, string][] = [["Restaurant", input.establishmentName], ["Entreprise", input.organizationName], ["Propriétaire", input.ownerName], ["E-mail", input.email], ["Fin de l'essai", input.trialEndsLabel]];
  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#f3f5f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#fff;border-radius:20px;overflow:hidden">
<tr><td style="background:linear-gradient(135deg,#14aaa3,#0f6e6c);padding:24px 28px;color:#fff"><div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.85">ManaResto · nouvelle inscription</div><div style="font-size:22px;font-weight:800;margin-top:6px">${esc(input.establishmentName)} vient de créer son compte</div><div style="font-size:13px;opacity:.9;margin-top:4px">${input.total} restaurant${input.total > 1 ? "s" : ""} inscrit${input.total > 1 ? "s" : ""} au total</div></td></tr>
<tr><td style="padding:22px 28px"><table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;font-size:14px">${rows.map(([k, v]) => `<tr><td style="padding:6px 0;color:#64748b;width:38%">${esc(k)}</td><td style="padding:6px 0;font-weight:700">${esc(v)}</td></tr>`).join("")}</table>
<p style="margin:20px 0 0;text-align:center"><a href="${esc(input.consoleUrl)}" style="display:inline-block;background:#f97c3c;color:#fff;text-decoration:none;font-weight:800;font-size:15px;padding:12px 22px;border-radius:12px">Voir dans la console</a></p>
<p style="margin:16px 0 0;font-size:13px;text-align:center"><a href="mailto:${esc(input.email)}" style="color:#0f6e6c">Écrire au restaurateur</a></p></td></tr>
</table></td></tr></table></body></html>`;
  const text = `Nouvelle inscription ManaResto\n\n${rows.map(([k, v]) => `${k} : ${v}`).join("\n")}\n\nConsole : ${input.consoleUrl}`;
  return { to: input.to, subject: `Nouveau compte ManaResto — ${input.establishmentName} (${input.ownerName})`, text, html, replyTo: input.email };
}
