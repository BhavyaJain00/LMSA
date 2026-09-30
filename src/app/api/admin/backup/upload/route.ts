import { NextResponse, type NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { isCrossSite } from "@/lib/media/upload-http";
import { MAX_BACKUP_UPLOAD_BYTES, getBackupManager } from "@/lib/db/backup";
import { authorizeBackupAdmin, backupActorLabel, describeBackupFailure } from "@/lib/db/backup-admin";

export const dynamic = "force-dynamic";

const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

function decodeFileName(value: string | null): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * POST /api/admin/backup/upload — store a backup file so it can be
 * restored. The request body is the file itself (`.sqlite` made by this
 * app, or a JSON export); `X-File-Name` carries its URL-encoded name.
 *
 * The body is streamed to disk (never buffered), checked (SQLite integrity
 * check, schema version, JSON shape) and listed as an "uploaded" backup.
 * Nothing is restored here: the administrator reviews the contents and
 * confirms on the data page. A route handler is used because Server Action
 * bodies are capped at 1 MB.
 *
 * Responds with `{ ok: true, backup }` or `{ ok: false, error }`.
 */
export async function POST(req: NextRequest) {
  if (isCrossSite(req)) return json({ ok: false, error: "This request was blocked. Reload the page and try again." }, 403);
  const access = await authorizeBackupAdmin("upload");
  if (!access.ok) return json({ ok: false, error: access.error }, access.status);

  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_BACKUP_UPLOAD_BYTES) {
    return json({ ok: false, error: `This file is larger than the ${Math.round(MAX_BACKUP_UPLOAD_BYTES / (1024 * 1024))} MB limit for backups.` }, 413);
  }
  if (!req.body) return json({ ok: false, error: "Choose a backup file to upload." }, 400);

  try {
    const manager = await getBackupManager();
    const backup = await manager.receiveUpload(req.body, {
      originalName: decodeFileName(req.headers.get("x-file-name")),
      createdBy: backupActorLabel(access.user),
    });
    await audit(access.user, "backup.upload", { type: "settings", id: "data" }, { name: backup.name, format: backup.format, bytes: backup.sizeBytes, records: backup.records });
    return json({ ok: true, backup }, 200);
  } catch (err) {
    const failure = describeBackupFailure(err, "The backup could not be uploaded. Please try again.");
    return json({ ok: false, error: failure.error }, failure.status);
  }
}
