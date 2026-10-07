import { Suspense } from "react";
import { OrderScreen } from "@/components/pos/order-screen";

/**
 * Hors ligne, le service worker sert un écran de commande générique : l'identifiant
 * est alors relu depuis l'URL côté client (voir OrderScreen).
 */
export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense><OrderScreen orderId={id} /></Suspense>;
}
