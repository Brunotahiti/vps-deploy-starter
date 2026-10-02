import type { Metadata } from "next";
import { ReserveScreen } from "@/components/public/reserve";

export const metadata: Metadata = { title: "Réserver", robots: { index: true, follow: true } };
export default async function ReservePage({ params }: { params: Promise<{ org: string; est: string }> }) {
  const { org, est } = await params;
  return <ReserveScreen org={org} est={est} />;
}
