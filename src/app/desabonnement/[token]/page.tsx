import type { Metadata } from "next";
import { Unsubscribe } from "@/components/public/unsubscribe";

export const metadata: Metadata = { title: "Désabonnement", robots: { index: false, follow: false } };

/** Lien « Se désabonner » des campagnes : un bouton, sans connexion. */
export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <Unsubscribe token={token} />;
}
