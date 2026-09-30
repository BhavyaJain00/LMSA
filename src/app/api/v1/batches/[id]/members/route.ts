import { revalidatePath } from "next/cache";
import { apiRoute, dataResponse, methodNotAllowed } from "@/lib/api/handler";
import { endpoints } from "@/lib/api/endpoints";
import { conflict } from "@/lib/api/errors";
import { findBatch, resolveMember } from "@/lib/api/lookups";
import { serializeBatchMember } from "@/lib/api/serializers";
import { getDb } from "@/lib/db/store";
import { enrollUserInBatch } from "@/lib/services/enrollment";

/** POST /api/v1/batches/{id}/members — add a member (by id or email) to a batch and its courses. Idempotent. */
export const POST = apiRoute(endpoints.addBatchMember, async (ctx) => {
  const { db, body } = ctx;
  const batch = findBatch(db, ctx.params.id!);
  const user = resolveMember(db, body);
  const existing = db.batchEnrollments.find((m) => m.batchId === batch.id && m.userId === user.id);
  if (existing) return dataResponse(serializeBatchMember(existing), 200);

  const result = await enrollUserInBatch(user.id, batch.id, { source: "API" });
  if (!result.ok) throw conflict(result.error, { seatCount: batch.seatCount });
  const member = (await getDb()).batchEnrollments.find((m) => m.batchId === batch.id && m.userId === user.id);
  if (!member) throw conflict("The member could not be added to this batch. Try again.");
  await ctx.audit("api.batch_member.add", { type: "batch", id: batch.id }, { userId: user.id, batchMemberId: member.id });
  revalidatePath(`/admin/batches/${batch.id}`);
  revalidatePath(`/batches/${batch.slug}`, "layout");
  return dataResponse(serializeBatchMember(member), 201);
});

/** Other methods answer 405 with the JSON error envelope. */
const unsupported = methodNotAllowed("POST");
export const GET = unsupported;
export const PUT = unsupported;
export const PATCH = unsupported;
export const DELETE = unsupported;
