import { apiRoute, listResponse, methodNotAllowed } from "@/lib/api/handler";
import { endpoints } from "@/lib/api/endpoints";
import { listPage } from "@/lib/api/pagination";
import { paymentStamps, serializePayment } from "@/lib/api/serializers";

/** GET /api/v1/payments — orders of every status, filterable and paginated. */
export const GET = apiRoute(endpoints.listPayments, async ({ db, query, url }) => {
  const rows = db.payments.filter(
    (p) =>
      (!query.status || p.status === query.status) &&
      (!query.userId || p.userId === query.userId) &&
      (!query.itemType || p.itemType === query.itemType) &&
      (!query.itemId || p.itemId === query.itemId),
  );
  return listResponse(listPage(rows, paymentStamps, query), url, serializePayment);
});

/** Other methods answer 405 with the JSON error envelope. */
const unsupported = methodNotAllowed("GET");
export const POST = unsupported;
export const PUT = unsupported;
export const PATCH = unsupported;
export const DELETE = unsupported;
