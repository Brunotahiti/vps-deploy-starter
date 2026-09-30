import type { Metadata } from "next";
import { InvitationScreen } from "@/components/invitation-screen";

export const metadata: Metadata = { title: "Rejoindre l'équipe" };
export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InvitationScreen token={token} />;
}
