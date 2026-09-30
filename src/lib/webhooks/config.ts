import "server-only";
import { decryptString, encryptString } from "@/lib/auth/crypto";
import type { SsrfOptions } from "./ssrf";

/**
 * Server-side settings of outgoing webhooks: secrets at rest and the
 * development escape hatch of the SSRF protection.
 */

/** Purpose label binding the AES-256-GCM ciphertext of a signing secret to this use. */
const SECRET_PURPOSE = "webhook-signing-secret";

/** Signing secret → `v1.<iv>.<tag>.<ciphertext>` (AES-256-GCM, key derived from APP_SECRET). */
export function encryptWebhookSecret(secret: string): string {
  return encryptString(secret, SECRET_PURPOSE);
}

/** The signing secret, or null when the stored value cannot be decrypted (APP_SECRET changed, tampering). */
export function decryptWebhookSecret(stored: string | undefined | null): string | null {
  return decryptString(stored, SECRET_PURPOSE);
}

/**
 * `WEBHOOKS_ALLOW_PRIVATE_NETWORK=true` lets a developer send webhooks to a
 * receiver on localhost or the local network. It is ignored in production,
 * where private, loopback and link-local destinations are always refused.
 */
export function webhookSsrfOptions(): SsrfOptions {
  const flag = (process.env.WEBHOOKS_ALLOW_PRIVATE_NETWORK ?? "").trim().toLowerCase();
  return { allowPrivate: process.env.NODE_ENV !== "production" && (flag === "true" || flag === "1") };
}
