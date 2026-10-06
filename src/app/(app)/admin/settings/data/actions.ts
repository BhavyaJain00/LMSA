"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/lib/types";
import { createSession } from "@/lib/auth/session";
import { buildDemoData, getDb } from "@/lib/db/store";
import { getBackupManager, type IntegrityReport, type RestorePreview } from "@/lib/db/backup";
import { authorizeBackupAdmin, backupActorLabel, describeBackupFailure } from "@/lib/db/backup-admin";
import { audit } from "@/lib/audit";
import { setFlash } from "@/lib/flash";
import { notifyMany } from "@/lib/services/notifications";
import { fd, pluralize } from "@/lib/utils";

/**
 * Server Actions of Admin → Settings → Backup & reset. Admin only, rate
 * limited, audited. Downloads and the upload of a backup file are route
 * handlers (`/api/admin/backup/**`) because they stream files.
 *
 * A failed step leaves the live data untouched: restores and the demo reset
 * write a safety backup first and replace the database in one transaction.
 */

const DATA_PAGE = "/admin/settings/data";
const AUDIT_TARGET = { type: "settings", id: "data" } as const;
const MAX_NOTE_LENGTH = 200;
const MAX_NAMES = 200;

/** Snapshot the database into the backups folder now. */
export async function createBackupAction(_prev: ActionResult<{ name: string }> | null, formData: FormData): Promise<ActionResult<{ name: string }>> {
  const access = await authorizeBackupAdmin("create");
  if (!access.ok) return { ok: false, error: access.error };
  const note = fd(formData, "note").replace(/\s+/g, " ").slice(0, MAX_NOTE_LENGTH);
  try {
    const manager = await getBackupManager();
    const backup = await manager.create({ kind: "manual", reason: note || undefined, createdBy: backupActorLabel(access.user) });
    await audit(access.user, "backup.create", AUDIT_TARGET, { name: backup.name, bytes: backup.sizeBytes, records: backup.records });
    revalidatePath(DATA_PAGE);
    return { ok: true, data: { name: backup.name }, message: "Backup created" };
  } catch (err) {
    return { ok: false, error: describeBackupFailure(err, "The backup could not be created. Please try again.").error };
  }
}

/** Delete one or more stored backups (form fields named `name`). */
export async function deleteBackupsAction(_prev: ActionResult<{ deleted: string[] }> | null, formData: FormData): Promise<ActionResult<{ deleted: string[] }>> {
  const access = await authorizeBackupAdmin("inspect");
  if (!access.ok) return { ok: false, error: access.error };
  const names = formData
    .getAll("name")
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .slice(0, MAX_NAMES);
  if (!names.length) return { ok: false, error: "Select at least one backup to delete." };
  try {
    const manager = await getBackupManager();
    const deleted = manager.delete(names);
    if (!deleted.length) return { ok: false, error: "Those backups no longer exist. Reload the page to see the current list." };
    await audit(access.user, "backup.delete", AUDIT_TARGET, { count: deleted.length, names: deleted.join(", ") });
    revalidatePath(DATA_PAGE);
    return { ok: true, data: { deleted }, message: `Deleted ${pluralize(deleted.length, "backup")}` };
  } catch (err) {
    return { ok: false, error: describeBackupFailure(err, "The backups could not be deleted. Please try again.").error };
  }
}

/** What restoring a backup would change (called when the restore dialog opens). */
export async function previewRestoreAction(name: string): Promise<ActionResult<RestorePreview>> {
  const access = await authorizeBackupAdmin("inspect");
  if (!access.ok) return { ok: false, error: access.error };
  if (typeof name !== "string" || !name) return { ok: false, error: "Choose a backup to restore." };
  try {
    const manager = await getBackupManager();
    return { ok: true, data: await manager.preview(name) };
  } catch (err) {
    return { ok: false, error: describeBackupFailure(err, "The backup could not be read. Please try again.").error };
  }
}

/**
 * Replace the whole database with a stored backup (typed confirmation
 * required). The data from just before is kept as a safety backup. On
 * success this redirects: back to the data page when the administrator's
 * account exists in the restored data, otherwise to the login page.
 */
export async function restoreBackupAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const access = await authorizeBackupAdmin("restore");
  if (!access.ok) return { ok: false, error: access.error };
  const actor = access.user;
  const name = fd(formData, "name");
  if (!name) return { ok: false, error: "Choose a backup to restore." };
  if (fd(formData, "confirm") !== "RESTORE") {
    return { ok: false, error: "Type RESTORE to confirm.", fieldErrors: { confirm: "Type RESTORE (in capitals) to confirm." } };
  }

  let summary: string;
  let safetyName: string;
  try {
    const manager = await getBackupManager();
    const result = await manager.restore(name, { createdBy: backupActorLabel(actor) });
    safetyName = result.safety.name;
    summary = `Restored ${pluralize(result.records, "record")} from ${result.restored.name}`;
    // Recorded in the restored database: its own audit log was replaced with the backup's.
    await audit(actor, "backup.restore", AUDIT_TARGET, { name: result.restored.name, kind: result.restored.kind, records: result.records, safetyBackup: safetyName });
  } catch (err) {
    return { ok: false, error: describeBackupFailure(err, "The backup could not be restored. Nothing was changed.").error };
  }

  revalidatePath("/", "layout");
  const db = await getDb();
  const stillExists = db.users.some((u) => u.id === actor.id && u.enabled);
  const otherAdmins = db.users.filter((u) => u.enabled && u.roles.includes("admin") && u.id !== actor.id).map((u) => u.id);
  await notifyMany(otherAdmins, {
    type: "system",
    subject: "The database was restored from a backup",
    message: `${actor.name} restored ${name}. The data from just before the restore is kept as ${safetyName}.`,
    link: DATA_PAGE,
    fromUserId: stillExists ? actor.id : undefined,
  }).catch((err) => console.error("[backup] could not notify administrators about the restore:", err));

  // Sessions came from the backup too. Keep the administrator signed in when their account is part of it.
  if (stillExists) {
    await createSession(actor.id);
    await setFlash(`${summary}. The previous data is kept as ${safetyName}.`, "success");
    redirect(DATA_PAGE);
  }
  await setFlash("The backup was restored. Sign in with an account from the restored data.", "info");
  redirect("/login");
}

/** Run SQLite's integrity check on the live database (`mode`: quick or full). */
export async function checkIntegrityAction(_prev: ActionResult<IntegrityReport> | null, formData: FormData): Promise<ActionResult<IntegrityReport>> {
  const access = await authorizeBackupAdmin("inspect");
  if (!access.ok) return { ok: false, error: access.error };
  const mode = fd(formData, "mode") === "full" ? "full" : "quick";
  try {
    const manager = await getBackupManager();
    const report = manager.checkIntegrity(mode);
    return { ok: true, data: report, message: report.ok ? "No problems found" : "The check found problems" };
  } catch (err) {
    return { ok: false, error: describeBackupFailure(err, "The integrity check could not run. Please try again.").error };
  }
}

/**
 * Replace every record with fresh demo data (typed confirmation required).
 * The data from just before is kept as a safety backup, so this can be
 * undone with "Restore". Everyone is signed out; the administrator stays
 * signed in when their account exists in the demo data.
 */
export async function reloadDemoDataAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const access = await authorizeBackupAdmin("restore");
  if (!access.ok) return { ok: false, error: access.error };
  const actor = access.user;
  if (fd(formData, "confirm") !== "RESET") {
    return { ok: false, error: "Type RESET to confirm.", fieldErrors: { confirm: "Type RESET (in capitals) to confirm." } };
  }

  let safetyName: string;
  try {
    const manager = await getBackupManager();
    const demo = await buildDemoData();
    // The safety backup and the reset run as one exclusive step, so nothing saved in between is lost.
    const safety = await manager.replaceWith(demo, { source: "demo-reset", reason: "Before reloading the demo data", createdBy: backupActorLabel(actor) });
    safetyName = safety.name;
    await audit(actor, "data.reset", AUDIT_TARGET, { safetyBackup: safetyName });
  } catch (err) {
    return { ok: false, error: describeBackupFailure(err, "The demo data could not be reloaded. Nothing was changed.").error };
  }

  revalidatePath("/", "layout");
  const db = await getDb();
  if (db.users.some((u) => u.id === actor.id && u.enabled)) {
    await createSession(actor.id);
    await setFlash(`Demo data reloaded. Your previous data is kept as ${safetyName}.`, "success");
    redirect(DATA_PAGE);
  }
  await setFlash("Demo data reloaded. Sign in with a demo account (password: password123).", "info");
  redirect("/login");
}
