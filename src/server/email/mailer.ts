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
export function receiptMail(input: { to: string; establishmentName: string; orderNumber: string; total: string; dateLabel: string; pdf: Buffer; isPaid: boolean; phone?: string | null; address?: string | null; reviewUrl?: string | null }): OutgoingMail {
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
${input.reviewUrl && input.isPaid ? `<p style="margin:18px 0 0;text-align:center"><a href="${esc(input.reviewUrl)}" style="display:inline-block;background:#f97c3c;color:#fff;font-weight:700;text-decoration:none;border-radius:12px;padding:10px 18px">⭐ Donnez-nous votre avis</a></p>` : ""}
<p style="margin:22px 0 0;font-size:14px">À bientôt · <em>Māuruuru</em></p></td></tr>
<tr><td style="padding:14px 28px;background:#f8fafc;font-size:11px;color:#94a3b8;text-align:center">Reçu envoyé par ManaResto pour ${esc(input.establishmentName)}. Ne pas répondre à cet e-mail automatique.</td></tr>
</table></td></tr></table></body></html>`;
  const text = `${title} — ${input.establishmentName}\nN° ${input.orderNumber} · ${input.dateLabel}\nMontant ${input.isPaid ? "réglé" : "à régler"} : ${input.total}\n\nLe document PDF est en pièce jointe. Merci de votre visite, māuruuru !${input.reviewUrl && input.isPaid ? `\nDonnez-nous votre avis : ${input.reviewUrl}` : ""}`;
  return { to: input.to, subject: `${title} ${input.orderNumber} — ${input.establishmentName}`, text, html, attachments: [{ filename: `recu-${input.orderNumber}.pdf`, content: input.pdf, contentType: "application/pdf" }] };
}

/** Confirmation, modification ou annulation d'une réservation, envoyée au client au nom du restaurant. */
export function reservationMail(input: { to: string; kind: "received" | "confirmed" | "declined" | "updated" | "cancelled"; establishmentName: string; name: string; partySize: number; dateLabel: string; timeLabel: string; phone?: string | null; address?: string | null; message?: string | null }): OutgoingMail {
  const TITLE = { received: "Demande de réservation reçue", confirmed: "Réservation confirmée", declined: "Réservation non disponible", updated: "Réservation modifiée", cancelled: "Réservation annulée" } as const;
  const LEAD = {
    received: "nous avons bien reçu votre demande de réservation. Le restaurant la vérifie et vous envoie sa réponse par e-mail.",
    confirmed: "votre table est réservée. Nous avons hâte de vous accueillir.",
    declined: "nous sommes désolés : nous ne pouvons pas vous accueillir à ce moment-là.",
    updated: "votre réservation a été modifiée. La voici à jour :",
    cancelled: "votre réservation est annulée.",
  } as const;
  const title = TITLE[input.kind];
  const lead = LEAD[input.kind];
  const people = `${input.partySize} personne${input.partySize > 1 ? "s" : ""}`;
  // Annulée ou refusée : réservation grisée, valeurs barrées (les intitulés restent lisibles)
  const struck = input.kind === "cancelled" || input.kind === "declined";
  const strike = struck ? ";text-decoration:line-through" : "";
  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#f3f5f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 6px 20px -8px rgba(15,23,42,.15)">
<tr><td style="background:linear-gradient(135deg,#14aaa3,#0f6e6c);padding:28px 28px 24px;color:#fff">
<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.85">${esc(input.establishmentName)}</div>
<div style="font-size:24px;font-weight:800;margin-top:6px">${title}</div></td></tr>
<tr><td style="padding:24px 28px">
<p style="margin:0 0 16px;font-size:15px;line-height:1.5">Bonjour ${esc(input.name)},<br>${lead}</p>
<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;background:#f1f4f8;border-radius:14px${struck ? ";opacity:.6" : ""}"><tr>
<td style="padding:16px 18px;vertical-align:top"><div style="font-size:12px;color:#64748b">Date</div><div style="font-size:16px;font-weight:800${strike}">${esc(input.dateLabel.replace(/^./, (c) => c.toUpperCase()))}</div></td>
<td style="padding:16px 18px;vertical-align:top"><div style="font-size:12px;color:#64748b">Heure</div><div style="font-size:16px;font-weight:800${strike}">${esc(input.timeLabel)}</div></td>
<td style="padding:16px 18px;vertical-align:top"><div style="font-size:12px;color:#64748b">Table pour</div><div style="font-size:16px;font-weight:800${strike}">${people}</div></td></tr></table>
${input.message ? `<p style="margin:18px 0 0;padding:14px 16px;background:#fff7ed;border-radius:12px;font-size:14px;line-height:1.5"><strong>Message du restaurant :</strong><br>${esc(input.message).replace(/\n/g, "<br>")}</p>` : ""}
<p style="margin:18px 0 0;font-size:13px;color:#475569;line-height:1.5">${input.kind === "cancelled" || input.kind === "declined" ? "Pour réserver à une autre date" : input.kind === "received" ? "Une question ou une demande urgente" : "Un empêchement ou un changement"} : ${input.phone ? `appelez-nous au <strong>${esc(input.phone)}</strong>.` : "contactez directement le restaurant."}</p>
${input.address ? `<p style="margin:12px 0 0;font-size:12px;color:#64748b">${esc(input.establishmentName)} · ${esc(input.address)}</p>` : ""}
<p style="margin:22px 0 0;font-size:14px">À bientôt · <em>Māuruuru</em></p></td></tr>
<tr><td style="padding:14px 28px;background:#f8fafc;font-size:11px;color:#94a3b8;text-align:center">E-mail envoyé par ManaResto pour ${esc(input.establishmentName)}. Ne pas répondre à cet e-mail automatique.</td></tr>
</table></td></tr></table></body></html>`;
  const text = `${title} — ${input.establishmentName}\nBonjour ${input.name}, ${lead}\n${input.dateLabel} à ${input.timeLabel} · ${people}\n${input.message ? `Message du restaurant : ${input.message}\n` : ""}${input.phone ? `Une question ? Appelez-nous au ${input.phone}.` : ""}\nMāuruuru !`;
  return { to: input.to, subject: `${title} · ${input.establishmentName} · ${input.dateLabel} ${input.timeLabel}`, text, html };
}

/** Commande à emporter prête : le client vient la chercher (ou le livreur part). */
export function readyMail(input: { to: string; establishmentName: string; name: string; call: string; delivery: boolean; phone?: string | null; trackUrl?: string | null }): OutgoingMail {
  const title = input.delivery ? "Votre commande part en livraison" : "Votre commande est prête !";
  const lead = input.delivery ? "votre commande est prête et part chez vous." : "votre commande vous attend au comptoir. Présentez ce numéro :";
  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#f3f5f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 6px 20px -8px rgba(15,23,42,.15)">
<tr><td style="background:linear-gradient(135deg,#14aaa3,#0f6e6c);padding:28px 28px 24px;color:#fff">
<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.85">${esc(input.establishmentName)}</div>
<div style="font-size:24px;font-weight:800;margin-top:6px">${title}</div></td></tr>
<tr><td style="padding:24px 28px">
<p style="margin:0 0 16px;font-size:15px;line-height:1.5">Bonjour ${esc(input.name)},<br>${lead}</p>
<div style="margin:0 auto 8px;width:140px;border-radius:18px;background:#f1f4f8;padding:14px 0;text-align:center"><div style="font-size:12px;color:#64748b">Commande n°</div><div style="font-size:44px;font-weight:800;color:#0f6e6c">${esc(input.call)}</div></div>
${input.trackUrl ? `<p style="margin:18px 0 0;text-align:center"><a href="${esc(input.trackUrl)}" style="color:#0f6e6c;font-weight:700">Suivre ma commande</a></p>` : ""}
${input.phone ? `<p style="margin:18px 0 0;font-size:13px;color:#475569">Une question ? Appelez-nous au <strong>${esc(input.phone)}</strong>.</p>` : ""}
<p style="margin:22px 0 0;font-size:14px">À tout de suite · <em>Māuruuru</em></p></td></tr>
<tr><td style="padding:14px 28px;background:#f8fafc;font-size:11px;color:#94a3b8;text-align:center">E-mail envoyé par ManaResto pour ${esc(input.establishmentName)}. Ne pas répondre à cet e-mail automatique.</td></tr>
</table></td></tr></table></body></html>`;
  const text = `${title} — ${input.establishmentName}\nBonjour ${input.name}, ${lead}\nCommande n° ${input.call}\n${input.trackUrl ? `Suivi : ${input.trackUrl}\n` : ""}Māuruuru !`;
  return { to: input.to, subject: `${title} · n° ${input.call} · ${input.establishmentName}`, text, html };
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
export function demoRequestMail(input: { to: string; restaurantName: string; contactName: string; phone?: string | null; email?: string | null; commune?: string | null; kind?: string | null; message?: string | null; consoleUrl?: string }): OutgoingMail {
  // Champs facultatifs (un seul moyen de contact suffit) : les lignes vides ne sont pas affichées
  const rows = ([["Établissement", input.restaurantName], ["Type", input.kind], ["Contact", input.contactName], ["Téléphone", input.phone], ["E-mail", input.email], ["Commune", input.commune]] as [string, string | null | undefined][])
    .filter((r): r is [string, string] => !!r[1]);
  const actions = [input.phone ? `<a href="tel:${esc(input.phone.replace(/[^+\d]/g, ""))}" style="color:#0f6e6c">Appeler</a>` : "", input.email ? `<a href="mailto:${esc(input.email)}" style="color:#0f6e6c">Répondre par e-mail</a>` : "", input.consoleUrl ? `<a href="${esc(input.consoleUrl)}" style="color:#0f6e6c">Ouvrir la console</a>` : ""].filter(Boolean).join(" · ");
  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#f3f5f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#fff;border-radius:20px;overflow:hidden">
<tr><td style="background:linear-gradient(135deg,#14aaa3,#0f6e6c);padding:24px 28px;color:#fff"><div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.85">ManaResto · site vitrine</div><div style="font-size:22px;font-weight:800;margin-top:6px">Nouvelle demande de démonstration</div></td></tr>
<tr><td style="padding:22px 28px"><table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;font-size:14px">${rows.map(([k, v]) => `<tr><td style="padding:6px 0;color:#64748b;width:38%">${esc(k)}</td><td style="padding:6px 0;font-weight:700">${esc(v)}</td></tr>`).join("")}</table>
${input.message ? `<p style="margin:16px 0 0;font-size:14px;line-height:1.5;white-space:pre-wrap"><b>Message :</b><br>${esc(input.message)}</p>` : ""}
<p style="margin:18px 0 0;font-size:13px">${actions}</p></td></tr>
</table></td></tr></table></body></html>`;
  const text = `Nouvelle demande de démonstration\n\n${rows.map(([k, v]) => `${k} : ${v}`).join("\n")}${input.message ? `\n\nMessage :\n${input.message}` : ""}`;
  return { to: input.to, subject: `Démo ManaResto — ${input.restaurantName}${input.commune ? ` (${input.commune})` : ""}`, text, html, replyTo: input.email || undefined };
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

/** Relance d'une facture de compte client pro, avec la facture en PDF. */
export function invoiceReminderMail(input: { to: string; establishmentName: string; number: string; issued: string; due: string; total: string; remaining: string; overdue: boolean; phone?: string | null; replyTo?: string | null; pdf: Buffer }): OutgoingMail {
  const title = input.overdue ? "Facture en attente de règlement" : "Rappel : facture à régler";
  const lead = input.overdue
    ? `sauf erreur de notre part, la facture <strong>${esc(input.number)}</strong> du ${esc(input.issued)}, arrivée à échéance le ${esc(input.due)}, n'est pas encore réglée.`
    : `voici un rappel de la facture <strong>${esc(input.number)}</strong> du ${esc(input.issued)}, à régler avant le ${esc(input.due)}.`;
  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#f3f5f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 6px 20px -8px rgba(15,23,42,.15)">
<tr><td style="background:linear-gradient(135deg,#14aaa3,#0f6e6c);padding:28px 28px 24px;color:#fff">
<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.85">${esc(input.establishmentName)}</div>
<div style="font-size:24px;font-weight:800;margin-top:6px">${title}</div></td></tr>
<tr><td style="padding:24px 28px">
<p style="margin:0 0 14px;font-size:15px;line-height:1.5">Bonjour,<br>${lead} Vous la trouverez en pièce jointe (PDF).</p>
<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;background:#f1f4f8;border-radius:14px"><tr><td style="padding:16px 18px;font-size:13px;color:#64748b">Reste à régler<br><span style="font-size:11px">sur un total de ${esc(input.total)}</span></td><td style="padding:16px 18px;text-align:right;font-size:22px;font-weight:800;color:#0f6e6c">${esc(input.remaining)}</td></tr></table>
<p style="margin:18px 0 0;font-size:14px;line-height:1.5">Si le règlement est déjà parti, merci de ne pas tenir compte de ce message.${input.phone ? ` Pour toute question : <strong>${esc(input.phone)}</strong>.` : ""}</p>
<p style="margin:22px 0 0;font-size:14px">Māuruuru · ${esc(input.establishmentName)}</p></td></tr>
<tr><td style="padding:14px 28px;background:#f8fafc;font-size:11px;color:#94a3b8;text-align:center">E-mail envoyé par ManaResto pour ${esc(input.establishmentName)}.</td></tr>
</table></td></tr></table></body></html>`;
  const text = `${title} — ${input.establishmentName}\nFacture ${input.number} du ${input.issued}, échéance le ${input.due}.\nReste à régler : ${input.remaining} (total ${input.total}).\nLa facture est en pièce jointe. Si le règlement est déjà parti, merci de ne pas tenir compte de ce message.${input.phone ? `\nQuestions : ${input.phone}` : ""}`;
  return { to: input.to, subject: `${title} ${input.number} — ${input.establishmentName}`, text, html, ...(input.replyTo ? { replyTo: input.replyTo } : {}), attachments: [{ filename: `facture-${input.number}.pdf`, content: input.pdf, contentType: "application/pdf" }] };
}

/** Devis traiteur : PDF joint et bouton pour l'accepter en ligne. */
export function quoteMail(input: { to: string; establishmentName: string; clientName: string; number: string; title: string; date: string; guests: number; total: string; deposit: string | null; validUntil: string; acceptUrl: string; phone?: string | null; replyTo?: string | null; pdf: Buffer }): OutgoingMail {
  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#f3f5f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 6px 20px -8px rgba(15,23,42,.15)">
<tr><td style="background:linear-gradient(135deg,#14aaa3,#0f6e6c);padding:28px 28px 24px;color:#fff">
<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.85">${esc(input.establishmentName)}</div>
<div style="font-size:24px;font-weight:800;margin-top:6px">Votre devis ${esc(input.number)}</div></td></tr>
<tr><td style="padding:24px 28px">
<p style="margin:0 0 14px;font-size:15px;line-height:1.5">Ia ora na ${esc(input.clientName)},<br>voici notre devis pour <strong>${esc(input.title)}</strong>, le ${esc(input.date)}, pour ${input.guests} personne${input.guests > 1 ? "s" : ""}. Vous le trouverez en pièce jointe (PDF).</p>
<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;background:#f1f4f8;border-radius:14px"><tr><td style="padding:16px 18px;font-size:13px;color:#64748b">Total TTC${input.deposit ? `<br><span style="font-size:11px">acompte à la commande : ${esc(input.deposit)}</span>` : ""}</td><td style="padding:16px 18px;text-align:right;font-size:22px;font-weight:800;color:#0f6e6c">${esc(input.total)}</td></tr></table>
<p style="margin:22px 0;text-align:center"><a href="${esc(input.acceptUrl)}" style="display:inline-block;background:#0f6e6c;color:#fff;text-decoration:none;font-weight:700;padding:14px 26px;border-radius:12px">Voir et accepter le devis</a></p>
<p style="margin:0;font-size:13px;color:#475569">Devis valable jusqu'au ${esc(input.validUntil)}.${input.phone ? ` Pour toute question : <strong>${esc(input.phone)}</strong>.` : ""}</p>
<p style="margin:22px 0 0;font-size:14px">Māuruuru · ${esc(input.establishmentName)}</p></td></tr>
<tr><td style="padding:14px 28px;background:#f8fafc;font-size:11px;color:#94a3b8;text-align:center">E-mail envoyé par ManaResto pour ${esc(input.establishmentName)}.</td></tr>
</table></td></tr></table></body></html>`;
  const text = `Votre devis ${input.number} — ${input.establishmentName}\n${input.title}, le ${input.date}, ${input.guests} personne(s).\nTotal TTC : ${input.total}${input.deposit ? ` (acompte à la commande : ${input.deposit})` : ""}.\nVoir et accepter le devis : ${input.acceptUrl}\nDevis valable jusqu'au ${input.validUntil}. Le devis est en pièce jointe.${input.phone ? `\nQuestions : ${input.phone}` : ""}`;
  return { to: input.to, subject: `Devis ${input.number} — ${input.establishmentName}`, text, html, ...(input.replyTo ? { replyTo: input.replyTo } : {}), attachments: [{ filename: `devis-${input.number}.pdf`, content: input.pdf, contentType: "application/pdf" }] };
}

/** Campagne marketing : texte du restaurant, prénom du client, lien de désabonnement obligatoire. */
export function campaignMail(input: { to: string; establishmentName: string; firstName?: string | null; subject: string; body: string; phone?: string | null; replyTo?: string | null; reviewUrl?: string | null; unsubscribeUrl: string }): OutgoingMail {
  const paragraphs = input.body.split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55">${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#f3f5f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 6px 20px -8px rgba(15,23,42,.15)">
<tr><td style="background:linear-gradient(135deg,#14aaa3,#0f6e6c);padding:26px 28px;color:#fff">
<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.85">${esc(input.establishmentName)}</div>
<div style="font-size:22px;font-weight:800;margin-top:6px">${esc(input.subject)}</div></td></tr>
<tr><td style="padding:24px 28px">
<p style="margin:0 0 14px;font-size:15px">Ia ora na${input.firstName ? ` ${esc(input.firstName)}` : ""},</p>
${paragraphs}
${input.reviewUrl ? `<p style="margin:18px 0 0;font-size:13px;color:#475569">Vous avez aimé votre dernier repas ? <a href="${esc(input.reviewUrl)}" style="color:#0f6e6c;font-weight:700">Laissez-nous un avis</a></p>` : ""}
${input.phone ? `<p style="margin:14px 0 0;font-size:13px;color:#475569">Réservations : <strong>${esc(input.phone)}</strong></p>` : ""}
<p style="margin:22px 0 0;font-size:14px">Māuruuru · ${esc(input.establishmentName)}</p></td></tr>
<tr><td style="padding:14px 28px;background:#f8fafc;font-size:11px;color:#94a3b8;text-align:center">Vous recevez cet e-mail car vous avez accepté de recevoir les offres de ${esc(input.establishmentName)}.<br><a href="${esc(input.unsubscribeUrl)}" style="color:#64748b">Se désabonner</a></td></tr>
</table></td></tr></table></body></html>`;
  const text = `${input.subject} — ${input.establishmentName}\n\nIa ora na${input.firstName ? ` ${input.firstName}` : ""},\n\n${input.body}\n\n${input.reviewUrl ? `Laissez-nous un avis : ${input.reviewUrl}\n` : ""}${input.phone ? `Réservations : ${input.phone}\n` : ""}\nSe désabonner : ${input.unsubscribeUrl}`;
  return { to: input.to, subject: `${input.subject} — ${input.establishmentName}`, text, html, ...(input.replyTo ? { replyTo: input.replyTo } : {}) };
}
