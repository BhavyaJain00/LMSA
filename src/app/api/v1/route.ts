import { apiRoute, dataResponse, methodNotAllowed } from "@/lib/api/handler";
import { endpoints } from "@/lib/api/endpoints";
import { API_KEY_RATE_LIMIT } from "@/lib/api/rate-limit";
import { serializeKeyInfo } from "@/lib/api/serializers";

/** GET /api/v1 — who am I: the key's name, scopes and rate limit (connection test). */
export const GET = apiRoute(endpoints.getKeyInfo, async ({ key, db, baseUrl }) =>
  dataResponse(serializeKeyInfo(key, API_KEY_RATE_LIMIT, { name: db.settings.brand.name, url: baseUrl })),
);

/** Other methods answer 405 with the JSON error envelope. */
const unsupported = methodNotAllowed("GET");
export const POST = unsupported;
export const PUT = unsupported;
export const PATCH = unsupported;
export const DELETE = unsupported;
