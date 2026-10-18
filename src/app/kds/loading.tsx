import { Spinner } from "@/components/ui/misc";

export default function KdsLoading() {
  return <div className="flex min-h-dvh items-center justify-center bg-nuit-950" aria-busy="true"><Spinner className="h-8 w-8" /></div>;
}
