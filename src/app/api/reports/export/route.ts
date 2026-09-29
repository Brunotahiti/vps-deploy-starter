import { route, parseQuery } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { exportQuery } from "@/server/schemas";
import { buildExport, toCsv, toPdf, toXlsx } from "@/server/reports/export";

/** Export CSV / Excel / PDF : `?type=period|products|orders|staff&format=csv|xlsx|pdf&from&to`. */
export const GET = route(async (req) => {
  const q = parseQuery(req, exportQuery);
  const ctx = await requirePermission(q.type === "staff" ? "staff.manage" : q.type === "orders" ? "orders.view_history" : "reports.view");
  const est = ctx.establishment;
  const { title, sheets } = await buildExport(est.id, q.type, q.from, q.to, est.timezone);
  const base = `manaresto-${q.type}-${q.from}-${q.to}`;
  if (q.format === "csv") return new Response(toCsv(sheets), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${base}.csv"` } });
  if (q.format === "xlsx") return new Response(new Uint8Array(await toXlsx(sheets, title)), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${base}.xlsx"` } });
  return new Response(new Uint8Array(await toPdf(sheets, title, est.name, est.currency)), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${base}.pdf"` } });
});
