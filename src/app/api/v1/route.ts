import { apiRoute, dataResponse } from "@/lib/api/handler";
import { endpoints } from "@/lib/api/endpoints";
import { API_KEY_RATE_LIMIT } from "@/lib/api/rate-limit";

/** GET /api/v1 — who am I: the key's name, scopes and rate limit (connection test). */
export const GET = apiRoute(endpoints.getKeyInfo, async ({ key, db, baseUrl }) =>
  dataResponse({
    apiVersion: "v1",
    key: {
      id: key.id,
      name: key.name,
      prefix: key.prefix,
      scopes: [...key.scopes],
      createdAt: key.createdAt,
      lastUsedAt: key.lastUsedAt ?? null,
    },
    rateLimit: { limit: API_KEY_RATE_LIMIT.limit, windowSeconds: API_KEY_RATE_LIMIT.windowMs / 1000 },
    site: { name: db.settings.brand.name, url: baseUrl },
  }),
);
