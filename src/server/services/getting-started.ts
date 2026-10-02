import { prisma } from "@/server/db";

/*
 * « Bien démarrer » : les étapes de mise en route d'un établissement, cochées d'après ses vraies données
 * (rien à déclarer à la main). Affiché sur le tableau de bord tant que tout n'est pas fait.
 */

export type StartStep = { key: string; title: string; hint: string; href: string; done: boolean };

export async function gettingStarted(establishmentId: string, userId: string) {
  const est = await prisma.establishment.findUniqueOrThrow({ where: { id: establishmentId }, select: { businessType: true } });
  const snack = est.businessType === "snack";
  const [products, tables, team, me, sessions, sales] = await Promise.all([
    prisma.product.count({ where: { establishmentId, isActive: true } }),
    snack ? Promise.resolve(0) : prisma.table.count({ where: { establishmentId, isActive: true } }),
    prisma.userEstablishment.count({ where: { establishmentId, user: { isActive: true, isOwner: false } } }),
    prisma.user.findUnique({ where: { id: userId }, select: { pinHash: true } }),
    prisma.cashSession.count({ where: { establishmentId } }),
    prisma.order.count({ where: { establishmentId, status: "PAID" } }),
  ]);
  const steps: StartStep[] = [
    { key: "menu", title: "Ajouter votre carte", hint: "Au moins 3 produits, avec leurs prix", href: "/admin/catalog/products", done: products >= 3 },
    ...(snack ? [] : [{ key: "floor", title: "Dessiner votre salle", hint: "Vos tables, pour prendre les commandes au bon endroit", href: "/admin/floor", done: tables >= 1 }]),
    { key: "pin", title: "Choisir votre code PIN", hint: "Pour ouvrir la caisse en deux secondes", href: "/admin/users", done: !!me?.pinHash },
    { key: "team", title: "Inviter votre équipe", hint: "Un profil pour chacun : gérant, cuisine, salle", href: "/admin/users", done: team >= 1 },
    { key: "cash", title: "Ouvrir la caisse", hint: "Avec votre fond de caisse du jour", href: "/pos/cash", done: sessions >= 1 },
    { key: "sale", title: "Encaisser une première vente", hint: "Une vraie, ou un essai que vous rembourserez", href: "/pos", done: sales >= 1 },
  ];
  // Restaurant déjà bien installé (dont le restaurant exemple) : pas de liste ni de bravo
  return { steps, done: steps.filter((s) => s.done).length, total: steps.length, established: sales >= 30 };
}
