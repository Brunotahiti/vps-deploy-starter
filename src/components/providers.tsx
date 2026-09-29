"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ToastProvider } from "@/components/ui/toast";
import { OfflineProvider } from "@/lib/offline/provider";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 5_000, retry: (count, err) => !(err instanceof Object && "status" in err && (err as { status: number }).status < 500) && count < 2, refetchOnWindowFocus: true },
        },
      }),
  );
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <OfflineProvider>{children}</OfflineProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
