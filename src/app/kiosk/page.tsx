import type { Metadata } from "next";
import { KioskScreen } from "@/components/public/kiosk";

export const metadata: Metadata = { title: "Borne" };
export default function KioskPage() { return <KioskScreen />; }
