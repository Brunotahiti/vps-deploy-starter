/**
 * ManaResto — configuration commerciale et légale du site vitrine (www.manaresto.com).
 * Un seul endroit à modifier. Les champs vides ne sont pas affichés sur le site.
 * NE PAS inventer de valeur : renseigner uniquement des informations exactes.
 */
window.MANARESTO_CONFIG = {
  app: "https://app.manaresto.com",     // application (inscription /signup, connexion /login)
  site: "https://www.manaresto.com",
  offer: { monthly: 12000, currency: "F CFP", commitmentMonths: 12, commission: 0, trialDays: 15 },
  business: {
    brand: "ManaResto",
    publisher: "ManaProcess",           // « ManaResto — Une solution ManaProcess »
    legalName: "",                      // raison sociale et forme juridique (ex. ManaProcess SARL)
    capital: "",                        // capital social
    tahitiNumber: "",                   // N° Tahiti
    rcs: "",                            // RCS Papeete
    address: "",                        // adresse du siège (Polynésie française)
    publicationDirector: "",            // directeur / directrice de la publication
    email: "contact@manaresto.com",     // e-mail de contact et légal
    phone: "",                          // téléphone professionnel (format +689 …)
    whatsapp: "",                       // numéro WhatsApp professionnel, chiffres uniquement (ex. 68987000000) — vide = bouton masqué
    hosting: "Hostinger International Ltd., 61 Lordou Vironos Street, 6023 Larnaca, Chypre (serveur privé virtuel)",
  },
};
