import type { NextRequest } from "next/server";
import { getAuthContext } from "@/server/auth/context";
import { realtime } from "@/server/realtime/bus";

export const dynamic = "force-dynamic";

/** Flux Server-Sent Events par établissement (caisse, cuisine, admin). */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx?.establishment) return new Response("Unauthorized", { status: 401 });
  const establishmentId = ctx.establishment.id;
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let keepalive: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    start(controller) {
      const send = (data: string, event?: string) => {
        try {
          controller.enqueue(encoder.encode(`${event ? `event: ${event}\n` : ""}data: ${data}\n\n`));
        } catch { /* flux fermé */ }
      };
      send(JSON.stringify({ type: "hello", establishmentId, at: new Date().toISOString() }));
      unsubscribe = realtime.subscribe(establishmentId, (ev) => send(JSON.stringify(ev)));
      keepalive = setInterval(() => send("", "ping"), 25000);
      req.signal.addEventListener("abort", () => {
        unsubscribe();
        if (keepalive) clearInterval(keepalive);
        try { controller.close(); } catch { /* déjà fermé */ }
      });
    },
    cancel() {
      unsubscribe();
      if (keepalive) clearInterval(keepalive);
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}
