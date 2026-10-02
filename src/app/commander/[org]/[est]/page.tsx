import type { Metadata } from "next";
import { ShopScreen } from "@/components/public/shop";

export const metadata: Metadata = { title: "Commander", robots: { index: true, follow: true } };
export default async function ShopPage({ params }: { params: Promise<{ org: string; est: string }> }) {
  const { org, est } = await params;
  return <ShopScreen org={org} est={est} />;
}
