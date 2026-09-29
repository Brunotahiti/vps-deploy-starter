import type { Metadata } from "next";
import { TrackScreen } from "@/components/public/track";

export const metadata: Metadata = { title: "Suivi de commande" };
export default async function TrackPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <TrackScreen token={token} />;
}
