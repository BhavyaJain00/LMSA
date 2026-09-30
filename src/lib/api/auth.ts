import "server-only";
import type { ApiKey, Database } from "@/lib/types";
import { perIpLimit } from "@/lib/auth/rate-limit";
import { update } from "@/lib/db/store";
import { ApiError } from "./errors";
import { matchApiKey, readBearerToken } from "./keys";
import { API_AUTH_FAILURE_LIMIT, API_AUTH_FAILURE_SHARED_LIMIT, apiAuthFailures } from "./rate-limit";

/**
 * Authenticate an API request from its `Authorization: Bearer <key>` header.
 *
 * Fails closed with the error envelope: missing header → 401 unauthorized,
 * unknown or malformed key → 401 invalid_api_key, revoked key → 401
 * revoked_api_key; a key whose creator is no longer an enabled admin → 401
 * invalid_api_key. Failed attempts are rate limited per client IP (so keys
 * can't be guessed at speed); once over the limit even correct keys from
 * that IP wait for `Retry-After`.
 */

const CHALLENGE = { "WWW-Authenticate": 'Bearer realm="api"' };
/** `lastUsedAt` is written at most this often per key (a write per request would be wasteful). */
const LAST_USED_RESOLUTION_MS = 60_000;

export function authenticateApiKey(db: Database, authorization: string | null, clientIp: string, now: number = Date.now()): ApiKey {
  const limit = perIpLimit("api-auth", clientIp, API_AUTH_FAILURE_LIMIT, API_AUTH_FAILURE_SHARED_LIMIT);
  const blocked = apiAuthFailures.check(limit.key, limit.rule, now);
  if (!blocked.ok) {
    const retryAfter = Math.max(1, Math.ceil(blocked.retryAfterMs / 1000));
    throw new ApiError(429, "rate_limited", "Too many requests with an invalid API key. Try again later.", { retryAfterSeconds: retryAfter }, { "Retry-After": String(retryAfter) });
  }

  const token = readBearerToken(authorization);
  if (!token) {
    throw new ApiError(401, "unauthorized", "Send your API key in the Authorization header: `Authorization: Bearer ll_live_…`.", null, CHALLENGE);
  }
  const match = matchApiKey(db.apiKeys, token);
  if (match.status === "valid") {
    if (isKeyOwnerActive(db, match.key)) return match.key;
    apiAuthFailures.hit(limit.key, limit.rule, now);
    throw new ApiError(
      401,
      "invalid_api_key",
      "This API key was created by a member who is no longer an active administrator, so it no longer works. An administrator can create a new key.",
      null,
      { "WWW-Authenticate": 'Bearer realm="api", error="invalid_token"' },
    );
  }

  apiAuthFailures.hit(limit.key, limit.rule, now);
  if (match.status === "revoked") {
    throw new ApiError(401, "revoked_api_key", "This API key was revoked. Create a new key in Admin → Settings → API & webhooks.", null, {
      "WWW-Authenticate": 'Bearer realm="api", error="invalid_token"',
    });
  }
  throw new ApiError(401, "invalid_api_key", "The API key is not valid. Check that you copied the whole key.", null, {
    "WWW-Authenticate": 'Bearer realm="api", error="invalid_token"',
  });
}

/**
 * Keys act with the authority of the administrator who created them, so a
 * key stops working when that member is deleted, disabled or loses the
 * admin role (fail closed; the key starts working again if they regain it).
 */
export function isKeyOwnerActive(db: Pick<Database, "users">, key: Pick<ApiKey, "createdById">): boolean {
  const owner = db.users.find((u) => u.id === key.createdById);
  return !!owner && owner.enabled && owner.roles.includes("admin");
}

/** Whether `lastUsedAt` is stale enough to be written again. */
export function shouldTouchKey(key: Pick<ApiKey, "lastUsedAt">, now: number = Date.now()): boolean {
  if (!key.lastUsedAt) return true;
  const last = Date.parse(key.lastUsedAt);
  return !Number.isFinite(last) || now - last >= LAST_USED_RESOLUTION_MS;
}

/** Record that a key was used (never throws). */
export async function touchApiKey(keyId: string, now: Date = new Date()): Promise<void> {
  try {
    await update("apiKeys", keyId, (row) => (row.revokedAt ? undefined : { lastUsedAt: now.toISOString() }));
  } catch (error) {
    console.error("[api] could not record key use:", error instanceof Error ? error.message : String(error));
  }
}
