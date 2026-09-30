"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, ApiKey } from "@/lib/types";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { getDb, mutate } from "@/lib/db/store";
import { audit } from "@/lib/audit";
import { notifyMany } from "@/lib/services/notifications";
import { generateApiKey } from "@/lib/api/keys";
import { normalizeScopes } from "@/lib/api/scopes";
import { fd, uid } from "@/lib/utils";

/**
 * Admin → Settings → API & webhooks: switch the API on or off, create keys
 * (the full key is returned once and never stored), revoke and delete them.
 * Every action re-checks the admin role and is recorded in the audit log;
 * other administrators are notified when a key is created.
 */

const PAGE = "/admin/settings/api";
const NAME_MIN = 2;
const NAME_MAX = 80;
/** Active (unrevoked) keys allowed at once. */
const MAX_ACTIVE_API_KEYS = 50;

async function requireAdmin() {
  const user = await getCurrentUser();
  return user && isAdmin(user) ? user : null;
}

export interface CreatedApiKey {
  /** The full key: shown once, never stored. */
  key: string;
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
}

export async function createApiKeyAction(_prev: ActionResult<CreatedApiKey> | null, formData: FormData): Promise<ActionResult<CreatedApiKey>> {
  const user = await requireAdmin();
  if (!user) return { ok: false, error: "Only administrators can manage API keys." };

  const name = fd(formData, "name").replace(/\s+/g, " ");
  const scopes = normalizeScopes(formData.getAll("scopes"));
  const fieldErrors: Record<string, string> = {};
  if (name.length < NAME_MIN || name.length > NAME_MAX) fieldErrors.name = `Name the key in ${NAME_MIN}–${NAME_MAX} characters, e.g. "Zapier" or "CRM sync".`;
  if (!scopes.length) fieldErrors.scopes = "Pick at least one permission.";
  if (Object.keys(fieldErrors).length) return { ok: false, error: Object.values(fieldErrors)[0]!, fieldErrors };

  const generated = generateApiKey();
  const row: ApiKey = {
    id: uid("key"),
    name,
    prefix: generated.prefix,
    keyHash: generated.keyHash,
    scopes,
    createdById: user.id,
    createdAt: new Date().toISOString(),
  };
  const saved = await mutate((db) => {
    if (db.apiKeys.filter((k) => !k.revokedAt).length >= MAX_ACTIVE_API_KEYS) return false;
    db.apiKeys.push(row);
    return true;
  });
  if (!saved) return { ok: false, error: `You already have ${MAX_ACTIVE_API_KEYS} active keys. Revoke keys you no longer use first.` };

  await audit(user, "api_key.create", { type: "api_key", id: row.id }, { name, prefix: row.prefix, scopes: scopes.join(" ") });
  const db = await getDb();
  const otherAdmins = db.users.filter((u) => u.enabled && u.id !== user.id && u.roles.includes("admin")).map((u) => u.id);
  await notifyMany(otherAdmins, {
    type: "system",
    subject: `${user.name} created the API key “${name}”`,
    message: `Permissions: ${scopes.join(", ")}. Review or revoke it in Settings → API & webhooks.`,
    link: PAGE,
    fromUserId: user.id,
  });
  revalidatePath(PAGE);
  return {
    ok: true,
    data: { key: generated.key, id: row.id, name, prefix: row.prefix, scopes },
    message: "API key created. Copy it now: it won't be shown again.",
  };
}

export async function revokeApiKeyAction(id: string): Promise<ActionResult> {
  const user = await requireAdmin();
  if (!user) return { ok: false, error: "Only administrators can manage API keys." };
  const revoked = await mutate((db) => {
    const row = db.apiKeys.find((k) => k.id === id);
    if (!row) return null;
    if (!row.revokedAt) row.revokedAt = new Date().toISOString();
    return { ...row };
  });
  if (!revoked) return { ok: false, error: "This key no longer exists." };
  await audit(user, "api_key.revoke", { type: "api_key", id }, { name: revoked.name, prefix: revoked.prefix });
  revalidatePath(PAGE);
  return { ok: true, data: undefined, message: `“${revoked.name}” was revoked. Requests with it now fail.` };
}

/** Delete a revoked key from the list (active keys must be revoked first). */
export async function deleteApiKeyAction(id: string): Promise<ActionResult> {
  const user = await requireAdmin();
  if (!user) return { ok: false, error: "Only administrators can manage API keys." };
  const outcome = await mutate((db): ApiKey | "missing" | "active" => {
    const index = db.apiKeys.findIndex((k) => k.id === id);
    const row = db.apiKeys[index];
    if (!row) return "missing";
    if (!row.revokedAt) return "active";
    db.apiKeys.splice(index, 1);
    return row;
  });
  if (outcome === "missing") return { ok: false, error: "This key no longer exists." };
  if (outcome === "active") return { ok: false, error: "Revoke the key before deleting it." };
  await audit(user, "api_key.delete", { type: "api_key", id }, { name: outcome.name, prefix: outcome.prefix });
  revalidatePath(PAGE);
  return { ok: true, data: undefined, message: `“${outcome.name}” was deleted.` };
}

/** Turn the public API (and outgoing webhooks) on or off for the whole site. */
export async function setApiEnabledAction(enabled: boolean): Promise<ActionResult<{ enabled: boolean }>> {
  const user = await requireAdmin();
  if (!user) return { ok: false, error: "Only administrators can change site settings." };
  if (typeof enabled !== "boolean") return { ok: false, error: "Choose on or off." };
  const previous = await mutate((db) => {
    const before = db.settings.api.enabled;
    db.settings.api = { ...db.settings.api, enabled };
    db.settings.updatedAt = new Date().toISOString();
    return before;
  });
  if (previous !== enabled) await audit(user, "settings.api", { type: "settings", id: "api" }, { enabled });
  revalidatePath(PAGE);
  return { ok: true, data: { enabled }, message: enabled ? "The API is on." : "The API is off. Requests are refused until you turn it back on." };
}
