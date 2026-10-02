/**
 * Réservations : réglages par défaut, créneaux des services, repères (anniversaire, terrasse…) et origine.
 * Partagé entre l'écran (prise au téléphone, planning) et le serveur (contrôles, plan de salle).
 */

export type ReservationService = { key: "lunch" | "dinner"; label: string; enabled: boolean; from: string; to: string };
export type ReservationSettings = {
  services: ReservationService[];
  /** Écart entre deux créneaux proposés (minutes) */
  interval: number;
  /** Durée d'une table réservée (minutes), pour éviter de donner deux fois la même table */
  duration: number;
  /** Couverts au plus par service (null : pas de limite) */
  capacity: number | null;
};

export const DEFAULT_RESERVATION_SETTINGS: ReservationSettings = {
  services: [
    { key: "lunch", label: "Midi", enabled: true, from: "11:30", to: "14:00" },
    { key: "dinner", label: "Soir", enabled: true, from: "18:30", to: "21:30" },
  ],
  interval: 15,
  duration: 90,
  capacity: null,
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Réglages enregistrés (establishment.settings.reservations) complétés par les valeurs par défaut */
export function normalizeReservationSettings(raw: unknown): ReservationSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<ReservationSettings>;
  const services = DEFAULT_RESERVATION_SETTINGS.services.map((d) => {
    const s = Array.isArray(r.services) ? r.services.find((x) => x && x.key === d.key) : undefined;
    return {
      ...d,
      enabled: s ? s.enabled !== false : d.enabled,
      from: s && HHMM.test(s.from) ? s.from : d.from,
      to: s && HHMM.test(s.to) ? s.to : d.to,
    };
  });
  const interval = [10, 15, 20, 30, 60].includes(Number(r.interval)) ? Number(r.interval) : DEFAULT_RESERVATION_SETTINGS.interval;
  const duration = Number.isInteger(r.duration) && r.duration! >= 30 && r.duration! <= 300 ? r.duration! : DEFAULT_RESERVATION_SETTINGS.duration;
  const capacity = Number.isInteger(r.capacity) && r.capacity! > 0 ? r.capacity! : null;
  return { services, interval, duration, capacity };
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Créneaux proposés pour un service (heure de début de 11:30 à 14:00 tous les quarts d'heure, par exemple) */
export function serviceSlots(service: Pick<ReservationService, "from" | "to">, interval: number): string[] {
  const out: string[] = [];
  for (let m = toMin(service.from); m <= toMin(service.to); m += interval) out.push(toHHMM(m));
  return out;
}

/** Service d'une heure « HH:mm » : midi avant 16 h, soir ensuite */
export function serviceOfTime(hhmm: string): "lunch" | "dinner" {
  return toMin(hhmm) < 16 * 60 ? "lunch" : "dinner";
}

/** Les 8 derniers chiffres : « +689 87 00 00 01 » et « 87000001 » sont le même numéro */
export const phoneKey = (p: string | null | undefined) => (p ?? "").replace(/\D/g, "").slice(-8);

export const RESERVATION_TAGS = [
  { key: "birthday", label: "Anniversaire", emoji: "🎂" },
  { key: "terrace", label: "Terrasse", emoji: "🌴" },
  { key: "quiet", label: "Au calme", emoji: "🌙" },
  { key: "baby", label: "Chaise bébé", emoji: "👶" },
  { key: "wheelchair", label: "Accès fauteuil", emoji: "♿" },
  { key: "business", label: "Repas d'affaires", emoji: "💼" },
] as const;
export type ReservationTag = (typeof RESERVATION_TAGS)[number]["key"];
export const isReservationTag = (k: string): k is ReservationTag => RESERVATION_TAGS.some((t) => t.key === k);

export const RESERVATION_SOURCES = {
  PHONE: { label: "Téléphone", emoji: "📞" },
  WALK_IN: { label: "Sur place", emoji: "🚶" },
  ONLINE: { label: "En ligne", emoji: "🌐" },
  OTHER: { label: "Autre", emoji: "💬" },
} as const;
export type ReservationSource = keyof typeof RESERVATION_SOURCES;

/** Réservations qui occupent encore une table (ni annulées, ni no-show, ni terminées) */
export const ACTIVE_RESERVATION = ["PENDING", "CONFIRMED", "ARRIVED", "SEATED"] as const;
