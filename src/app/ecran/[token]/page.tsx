import type { Metadata } from "next";
import { MenuScreen } from "@/components/screens/menu-screen";

export const metadata: Metadata = { title: "Carte", robots: { index: false, follow: false } };

/** Écran en salle : la carte sur une télévision (adresse secrète, sans connexion). */
export default async function ScreenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <MenuScreen token={token} />;
}
