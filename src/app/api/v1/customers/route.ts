import { route, ok } from "@/server/http";
import { requireApiKey } from "@/server/api-keys";
import { listCustomers } from "@/server/services/customers";

export const GET = route(async (req) => {
  const ctx = await requireApiKey(req, "customers:read");
  const rows = await listCustomers(ctx.organizationId, { search: req.nextUrl.searchParams.get("search") ?? undefined, establishmentId: ctx.establishmentId, take: 500 });
  return ok(rows.map((c) => ({ id: c.id, firstName: c.firstName, lastName: c.lastName, phone: c.phone, email: c.email, visitCount: c.visitCount, totalSpent: c.totalSpent, points: c.points, createdAt: c.createdAt })));
});
