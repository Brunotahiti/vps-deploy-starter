import type { Metadata } from "next";
import { TableMenuScreen } from "@/components/public/table-menu";

export const metadata: Metadata = { title: "Menu" };
export default async function TableMenuPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <TableMenuScreen token={token} />;
}
