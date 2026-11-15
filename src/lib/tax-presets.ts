/**
 * Changement de TVA de toute la carte (ex. TVA des îles à 1 %, hors produits sucrés et alcool).
 * Les catégories dont le nom évoque l'alcool ou le sucré sont proposées cochées « garder le taux actuel » :
 * le gérant décoche ou coche selon sa carte, rien n'est imposé.
 */
export const KEEP_RATE_HINT = /alcool|bi[eè]re|\bvins?\b|cocktail|spiritueu|rhum|whisk|ap[ée]ro|ap[ée]ritif|digestif|liqueur|punch|champagne|boisson|soda|sucr|dessert|glace|g[aâ]teau|p[aâ]tisserie|cr[eê]pe|bonbon|confiserie|chocolat|viennoiserie|sirop/i;
export const suggestKeepRate = (categoryName: string) => KEEP_RATE_HINT.test(categoryName.normalize("NFC"));

/** Préréglage proposé sur la page TVA */
export const ISLANDS_PRESET = { name: "TVA îles", pct: "1" } as const;
