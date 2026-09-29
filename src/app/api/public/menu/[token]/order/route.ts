import { route, ok, parseBody } from "@/server/http";
import { tableOrderSchema } from "@/server/schemas";
import { orderFromTable } from "@/server/services/public";

export const POST = route<{ token: string }>(async (req, { params }) => ok(await orderFromTable(params.token, await parseBody(req, tableOrderSchema))));
