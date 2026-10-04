import type { OptionKey } from "./options";

/**
 * Captures d'écran des options payantes, montrées dans la visionneuse de Gestion → Options.
 * Images : public/options/<option>-<n>.webp (1280 × 800), prises dans le restaurant exemple par
 * scripts/option-screenshots.mjs — même ordre que ce script.
 */
export const OPTION_SHOTS: Record<OptionKey, string[]> = {
  stock: [
    "Le stock de chaque ingrédient, sa valeur et les alertes de stock bas",
    "Les recettes : le stock baisse à chaque plat vendu, le coût matière se calcule tout seul",
    "Bons de commande aux fournisseurs et réceptions",
  ],
  digital: [
    "Le site du restaurant, à une belle adresse à partager",
    "QR code à table : la carte et la commande depuis le téléphone du client",
    "Commande en ligne à emporter ou en livraison, sans commission",
    "Réservation en ligne en quelques secondes",
  ],
  team: [
    "Le planning de la semaine, service par service",
    "Le pointage des arrivées, pauses et départs",
    "Heures travaillées et coût du personnel",
  ],
  stats: [
    "Les ventes de la période et les faits marquants",
    "Rapports sur la période de votre choix, exports tableur et PDF",
  ],
  continuity: [
    "Sans internet, la caisse continue : la table s'ouvre, la commande part, tout se synchronise au retour du réseau",
    "Le boîtier de secours prend le relais pendant les longues coupures",
  ],
  ai: [
    "Prévisions de fréquentation à 14 jours, du jour calme au jour très chargé",
    "Analyse qualité inspirée de la norme ISO 9001, avec un plan d'actions",
    "Commande d'achats proposée selon votre consommation",
  ],
  hygiene: [
    "Les relevés et le nettoyage du jour, à cocher par l'équipe",
    "Les températures des frigos et congélateurs, avec alerte hors limites",
    "Traçabilité des préparations et dates limites",
  ],
  accounts: [
    "Les comptes clients pro : encours, factures à émettre, retards",
  ],
  marketing: [
    "Cartes cadeaux vendues à la caisse, utilisables en plusieurs fois",
    "Campagnes par e-mail aux clients qui l'ont accepté",
    "Avis Google : lien sur les reçus et affiche avec QR code",
  ],
  screens: [
    "Votre carte sur une télévision, toujours à jour",
    "Plusieurs écrans : comptoir, terrasse, vitrine",
  ],
  catering: [
    "Le planning des événements, devis et acomptes",
  ],
  bar: [
    "Les ardoises ouvertes au comptoir",
    "Les fiches cocktails pour le barman : doses, verre, garniture",
    "Le happy hour automatique sur les boissons de votre choix",
    "La cave du bar en bouteilles et en cl",
    "Le rapport du bar : ventes, offerts, casse",
  ],
  wine: [
    "La cave par couleur ou par emplacement, avec les alertes",
    "La fiche de chaque vin : dégustation, apogée, accords, prix",
    "À la caisse, les vins conseillés selon les plats commandés",
    "Le vin au verre : les bouteilles ouvertes et celles à écouler",
    "La carte des vins toujours à jour, en PDF et sur votre site",
  ],
  advanced: [
    "Tous vos établissements depuis un seul compte",
    "Le journal d'audit des opérations sensibles",
    "API et intégrations : clés, webhooks, imprimantes réseau, terminal de paiement",
  ],
};

/** Image de couverture de la carte (et première montrée par la visionneuse), si ce n'est pas la première */
export const OPTION_COVER: Partial<Record<OptionKey, number>> = { bar: 1 };
export const optionCover = (key: OptionKey) => OPTION_COVER[key] ?? 0;

export const optionShotUrl = (key: OptionKey, index: number) => `/options/${key}-${index + 1}.webp`;
