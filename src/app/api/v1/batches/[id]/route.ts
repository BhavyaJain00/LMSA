import { apiRoute, dataResponse, methodNotAllowed } from "@/lib/api/handler";
import { endpoints } from "@/lib/api/endpoints";
import { findBatch, userMap } from "@/lib/api/lookups";
import { serializeBatch } from "@/lib/api/serializers";
import { getBatchStatus } from "@/lib/data/batches";

/** GET /api/v1/batches/{id} — one batch, by id or slug. */
export const GET = apiRoute(endpoints.getBatch, async ({ db, params, baseUrl }) => {
  const batch = findBatch(db, params.id!);
  const seatsTaken = db.batchEnrollments.filter((m) => m.batchId === batch.id).length;
  return dataResponse(serializeBatch(batch, { seatsTaken, status: getBatchStatus(batch) }, userMap(db), { baseUrl }));
});

/** Other methods answer 405 with the JSON error envelope. */
const unsupported = methodNotAllowed("GET");
export const POST = unsupported;
export const PUT = unsupported;
export const PATCH = unsupported;
export const DELETE = unsupported;
