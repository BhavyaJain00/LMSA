"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, ErrorEvent } from "@/lib/types";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { mutate } from "@/lib/db/store";
import { audit } from "@/lib/audit";
import { normalizeErrorIds } from "./shared";

/**
 * Admin error log actions: resolve / reopen and delete error groups. Admin
 * only, audited (one event per group for single changes, one summary event
 * for bulk changes).
 */

type CountResult = ActionResult<{ count: number }>;

const DENIED = { ok: false as const, error: "Only administrators can manage the error log." };
const LIST_PATH = "/admin/errors";

async function requireAdmin() {
  const user = await getCurrentUser();
  return user && isAdmin(user) ? user : null;
}

function revalidate(ids: string[]) {
  revalidatePath(LIST_PATH);
  for (const id of ids.slice(0, 50)) revalidatePath(`${LIST_PATH}/${id}`);
}

function summary(event: Pick<ErrorEvent, "message" | "path">) {
  return { message: event.message.slice(0, 160), path: event.path ?? null };
}

async function auditChange(user: { id: string }, action: string, changed: Pick<ErrorEvent, "id" | "message" | "path">[], extra: Record<string, string | number | boolean> = {}) {
  if (changed.length === 1) await audit(user, action, { type: "error", id: changed[0]!.id }, { ...summary(changed[0]!), ...extra });
  else if (changed.length > 1) await audit(user, action, undefined, { count: changed.length, ...extra });
}

/** Mark groups resolved (`resolved = true`) or open them again. */
export async function setErrorsResolvedAction(rawIds: string[], resolved: boolean): Promise<CountResult> {
  const user = await requireAdmin();
  if (!user) return DENIED;
  const ids = normalizeErrorIds(rawIds);
  if (!ids.length) return { ok: false, error: "Select at least one error." };
  const want = resolved === true;

  const changed = await mutate((db) => {
    const wanted = new Set(ids);
    const out: Pick<ErrorEvent, "id" | "message" | "path">[] = [];
    for (const e of db.errorEvents) {
      if (!wanted.has(e.id) || !!e.resolved === want) continue;
      e.resolved = want;
      out.push({ id: e.id, message: e.message, path: e.path });
    }
    return out;
  });
  if (!changed.length) {
    return { ok: true, data: { count: 0 }, message: want ? "Already resolved." : "Already open." };
  }
  await auditChange(user, want ? "error.resolve" : "error.reopen", changed);
  revalidate(changed.map((c) => c.id));
  const noun = changed.length === 1 ? "error" : `${changed.length} errors`;
  return {
    ok: true,
    data: { count: changed.length },
    message: want ? `Marked ${noun} resolved. ${changed.length === 1 ? "It reopens" : "They reopen"} if it happens again.` : `Reopened ${noun}.`,
  };
}

/** Delete groups for good (a new occurrence starts a fresh group). */
export async function deleteErrorsAction(rawIds: string[]): Promise<CountResult> {
  const user = await requireAdmin();
  if (!user) return DENIED;
  const ids = normalizeErrorIds(rawIds);
  if (!ids.length) return { ok: false, error: "Select at least one error." };

  const removed = await mutate((db) => {
    const wanted = new Set(ids);
    const gone = db.errorEvents.filter((e) => wanted.has(e.id)).map((e) => ({ id: e.id, message: e.message, path: e.path }));
    if (gone.length) db.errorEvents = db.errorEvents.filter((e) => !wanted.has(e.id));
    return gone;
  });
  if (!removed.length) return { ok: false, error: "These errors were already deleted." };
  await auditChange(user, "error.delete", removed);
  revalidate(removed.map((r) => r.id));
  return { ok: true, data: { count: removed.length }, message: removed.length === 1 ? "Error deleted." : `${removed.length} errors deleted.` };
}

/** Clear out every resolved group. */
export async function deleteResolvedErrorsAction(): Promise<CountResult> {
  const user = await requireAdmin();
  if (!user) return DENIED;
  const removed = await mutate((db) => {
    const gone = db.errorEvents.filter((e) => e.resolved).map((e) => ({ id: e.id, message: e.message, path: e.path }));
    if (gone.length) db.errorEvents = db.errorEvents.filter((e) => !e.resolved);
    return gone;
  });
  if (!removed.length) return { ok: true, data: { count: 0 }, message: "There are no resolved errors to delete." };
  await auditChange(user, "error.delete", removed, { scope: "resolved" });
  revalidate(removed.map((r) => r.id));
  return { ok: true, data: { count: removed.length }, message: removed.length === 1 ? "Deleted 1 resolved error." : `Deleted ${removed.length} resolved errors.` };
}
