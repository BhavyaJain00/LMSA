import { apiRoute, listResponse, methodNotAllowed } from "@/lib/api/handler";
import { endpoints } from "@/lib/api/endpoints";
import { matchesText, userMap } from "@/lib/api/lookups";
import { listPage } from "@/lib/api/pagination";
import { batchStamps, serializeBatch } from "@/lib/api/serializers";
import { getBatchStatus } from "@/lib/data/batches";

/** GET /api/v1/batches — every batch (drafts included), filterable and paginated. */
export const GET = apiRoute(endpoints.listBatches, async ({ db, query, url, baseUrl }) => {
  const now = Date.now();
  const rows = db.batches.filter(
    (b) =>
      matchesText(query.q, b.title, b.slug, b.description) &&
      (query.published === undefined || b.published === query.published) &&
      (!query.courseId || b.courseIds.includes(query.courseId)) &&
      (!query.status || getBatchStatus(b, now) === query.status),
  );
  const seats = new Map<string, number>();
  for (const member of db.batchEnrollments) seats.set(member.batchId, (seats.get(member.batchId) ?? 0) + 1);
  const users = userMap(db);
  return listResponse(listPage(rows, batchStamps, query), url, (batch) =>
    serializeBatch(batch, { seatsTaken: seats.get(batch.id) ?? 0, status: getBatchStatus(batch, now) }, users, { baseUrl }),
  );
});

/** Other methods answer 405 with the JSON error envelope. */
const unsupported = methodNotAllowed("GET");
export const POST = unsupported;
export const PUT = unsupported;
export const PATCH = unsupported;
export const DELETE = unsupported;
