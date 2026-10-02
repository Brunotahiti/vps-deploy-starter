import type { MetadataRoute } from "next";

// Adresse du serveur lue au démarrage, pas à la compilation
export const dynamic = "force-dynamic";

const base = () => process.env.PUBLIC_URL?.replace(/\/$/, "") || "https://app.manaresto.com";

/**
 * app.manaresto.com : seules les pages publiques des restaurants (site, commande, réservation) intéressent les moteurs
 * de recherche ; la caisse, la gestion et l'API ne doivent jamais apparaître dans Google.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{
      userAgent: "*",
      allow: ["/site/", "/commander/", "/reserver/"],
      disallow: ["/api/", "/admin", "/pos", "/kds", "/platform", "/onboarding", "/kiosk", "/suivi/", "/invitation/", "/desabonnement/", "/devis/", "/ecran/", "/m/", "/salle", "/commande$", "/commande/", "/demo"],
    }],
    sitemap: `${base()}/sitemap.xml`,
  };
}
