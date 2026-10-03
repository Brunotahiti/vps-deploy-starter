"use client";

import { useCallback, useSyncExternalStore } from "react";

/** i18n des interfaces clients (menu QR, commande en ligne, borne, réservation) : français, anglais, tahitien. */
export type Lang = "fr" | "en" | "ty";
export const LANGS: { code: Lang; label: string; flag: string }[] = [{ code: "fr", label: "Français", flag: "🇫🇷" }, { code: "en", label: "English", flag: "🇬🇧" }, { code: "ty", label: "Reo Tahiti", flag: "🇵🇫" }];

const DICT = {
  fr: {
    menu: "Menu", table: "Table", callWaiter: "Appeler un serveur", called: "Un serveur arrive !", order: "Commander", cart: "Ma commande", empty: "Votre commande est vide", add: "Ajouter", total: "Total", send: "Envoyer la commande", sent: "Commande envoyée !", awaiting: "En attente de validation par le personnel", inKitchen: "En préparation en cuisine", ready: "Prêt !", search: "Rechercher…", all: "Tout", options: "options", from: "dès", notes: "Note pour la cuisine", covers: "Nombre de personnes", ordered: "Déjà commandé", orderMore: "Commander à nouveau", closedMenu: "Consultation du menu uniquement : commandez auprès de votre serveur.",
    pickup: "À emporter", delivery: "Livraison", when: "Heure souhaitée", asap: "Dès que possible", name: "Votre nom", phone: "Téléphone", email: "Email (facultatif)", address: "Adresse de livraison", zone: "Commune", contact: "Vos coordonnées", confirm: "Confirmer la commande", deliveryFee: "Frais de livraison", minOrder: "Minimum en livraison", closed: "La commande en ligne n'est pas ouverte pour le moment.", leadTime: "Préparation environ", minutes: "min", payAtPickup: "Paiement sur place au retrait", payAtDelivery: "Paiement à la livraison", track: "Suivre ma commande", orderNumber: "Commande n°",
    stageRECEIVED: "Reçue, en attente d'acceptation", stageACCEPTED: "Acceptée", stagePREPARING: "En préparation", stageREADY: "Prête", stageDONE: "Terminée", stageCANCELLED: "Annulée", refresh: "Actualiser", thanks: "Merci pour votre commande !",
    kioskWelcome: "Bienvenue", kioskStart: "Touchez pour commander", dineIn: "Sur place", takeaway: "À emporter", firstName: "Votre prénom (pour l'appel)", pay: "Payer en caisse", kioskDone: "Présentez ce numéro en caisse pour régler", newOrder: "Nouvelle commande", back: "Retour", validate: "Valider",
    reserve: "Réserver une table", date: "Date", time: "Heure", partySize: "Nombre de personnes", allergies: "Allergies (facultatif)", specialRequests: "Demandes particulières", book: "Envoyer la demande", booked: "Demande envoyée ! Le restaurant vous répond par e-mail dès qu'il l'a validée.", people: "pers.", reserveEmail: "E-mail", reserveEmailHint: "Obligatoire : vous recevez la réponse du restaurant par e-mail.", reserveEmailInvalid: "Adresse e-mail invalide",
  },
  en: {
    menu: "Menu", table: "Table", callWaiter: "Call a waiter", called: "A waiter is on the way!", order: "Order", cart: "My order", empty: "Your order is empty", add: "Add", total: "Total", send: "Send order", sent: "Order sent!", awaiting: "Waiting for staff validation", inKitchen: "Being prepared", ready: "Ready!", search: "Search…", all: "All", options: "options", from: "from", notes: "Note for the kitchen", covers: "Number of guests", ordered: "Already ordered", orderMore: "Order again", closedMenu: "Menu only: please order with your waiter.",
    pickup: "Pickup", delivery: "Delivery", when: "Preferred time", asap: "As soon as possible", name: "Your name", phone: "Phone", email: "Email (optional)", address: "Delivery address", zone: "Area", contact: "Your details", confirm: "Confirm order", deliveryFee: "Delivery fee", minOrder: "Minimum for delivery", closed: "Online ordering is currently closed.", leadTime: "Ready in about", minutes: "min", payAtPickup: "Pay at pickup", payAtDelivery: "Pay on delivery", track: "Track my order", orderNumber: "Order no.",
    stageRECEIVED: "Received, awaiting acceptance", stageACCEPTED: "Accepted", stagePREPARING: "Being prepared", stageREADY: "Ready", stageDONE: "Completed", stageCANCELLED: "Cancelled", refresh: "Refresh", thanks: "Thank you for your order!",
    kioskWelcome: "Welcome", kioskStart: "Touch to order", dineIn: "Eat in", takeaway: "Take away", firstName: "Your first name (for the call)", pay: "Pay at the counter", kioskDone: "Show this number at the counter to pay", newOrder: "New order", back: "Back", validate: "Confirm",
    reserve: "Book a table", date: "Date", time: "Time", partySize: "Number of guests", allergies: "Allergies (optional)", specialRequests: "Special requests", book: "Send request", booked: "Request sent! The restaurant will reply by email once it has confirmed.", people: "guests", reserveEmail: "Email", reserveEmailHint: "Required: you will receive the restaurant's reply by email.", reserveEmailInvalid: "Invalid email address",
  },
  ty: {
    menu: "Tāpura mā'a", table: "'Amura'a", callWaiter: "Pi'i i te ta'ata tāvini", called: "Te haere mai nei te ta'ata tāvini!", order: "Ani mā'a", cart: "Tā'u ani", empty: "'Aita ā tā 'oe ani", add: "'Āpiti", total: "Tā'ato'a", send: "Fa'atae i te ani", sent: "'Ua tae te ani!", awaiting: "Tīa'i i te fa'ati'a a te ta'ata rave 'ohipa", inKitchen: "Tē fa'aineine-hia nei", ready: "'Ua oti!", search: "Mā'imi…", all: "Te mau mea ato'a", options: "mā'iti", from: "mai", notes: "Fa'a'ite nō te fare tunu", covers: "Rahira'a ta'ata", ordered: "'Ua ani-a'e-na", orderMore: "Ani fa'ahou", closedMenu: "Hi'o-noa i te tāpura : ani i tō 'oe ta'ata tāvini.",
    pickup: "Rave ē haere", delivery: "Hōpoi", when: "Hora hina'aro-hia", asap: "Vitiviti roa", name: "Tō 'oe i'oa", phone: "Niuniu", email: "Rata uira (i te hina'aro)", address: "Vāhi hōpoi", zone: "'Oire", contact: "Tō 'oe mau fa'a'ite", confirm: "Ha'apāpū i te ani", deliveryFee: "Moni hōpoi", minOrder: "Moni iti roa nō te hōpoi", closed: "'Aita te ani nā ni'a i te 'āpiti i te mātara i teie nei.", leadTime: "Fa'aineine i roto i", minutes: "min", payAtPickup: "'Aufau i te taime rave", payAtDelivery: "'Aufau i te taime hōpoi", track: "Hi'o i tā'u ani", orderNumber: "Ani nūmera",
    stageRECEIVED: "'Ua fāri'i-hia, tīa'i", stageACCEPTED: "'Ua fa'ati'a-hia", stagePREPARING: "Tē fa'aineine-hia nei", stageREADY: "'Ua oti", stageDONE: "'Ua hope", stageCANCELLED: "'Ua fa'a'ore-hia", refresh: "Fa'a'āpī", thanks: "Māuruuru nō tā 'oe ani!",
    kioskWelcome: "Maeva", kioskStart: "Pāto'i nō te ani", dineIn: "I 'ō nei", takeaway: "Rave ē haere", firstName: "Tō 'oe i'oa (nō te pi'i)", pay: "'Aufau i te vāhi 'aufaura'a", kioskDone: "Fa'a'ite i teie nūmera i te vāhi 'aufaura'a", newOrder: "Ani 'āpī", back: "Ho'i", validate: "Ha'apāpū",
    reserve: "Tāpa'o i te hō'ē 'amura'a", date: "Mahana", time: "Hora", partySize: "Rahira'a ta'ata", allergies: "Ma'i fa'aore (i te hina'aro)", specialRequests: "Anira'a ta'a'ē", book: "Fa'atae i te anira'a", booked: "'Ua tae te anira'a!", people: "ta'ata", reserveEmail: "Rata uira",
  },
} as const;
export type Key = keyof typeof DICT.fr;

const listeners = new Set<() => void>();
function read(): Lang { try { const l = (new URLSearchParams(window.location.search).get("lang") || localStorage.getItem("mr-lang")) as Lang | null; return l && l in DICT ? l : "fr"; } catch { return "fr"; } }
export function usePublicLang() {
  const lang = useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, read, () => "fr" as Lang);
  const setLang = useCallback((l: Lang) => { try { localStorage.setItem("mr-lang", l); } catch {} listeners.forEach((cb) => cb()); }, []);
  // Texte absent dans une langue (traduction non disponible) : le français
  const t = useCallback((k: Key) => (DICT[lang] as Partial<Record<Key, string>>)[k] ?? DICT.fr[k], [lang]);
  return { lang, setLang, t };
}

export function LangSwitch({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  return <div className="flex gap-1">{LANGS.map((l) => <button key={l.code} onClick={() => setLang(l.code)} className={`touch h-9 rounded-full px-2.5 text-sm font-bold ${lang === l.code ? "bg-brand text-white shadow-glow" : "surface-2 text-muted"}`} title={l.label}>{l.flag}<span className="ml-1 hidden sm:inline">{l.code.toUpperCase()}</span></button>)}</div>;
}
