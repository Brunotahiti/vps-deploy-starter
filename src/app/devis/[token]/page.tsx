import type { Metadata } from "next";
import { QuoteView } from "@/components/public/quote";

export const metadata: Metadata = { title: "Votre devis", robots: { index: false, follow: false } };

/** Devis traiteur consulté par le client depuis le lien reçu : il peut l'accepter en ligne. */
export default async function QuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <QuoteView token={token} />;
}
