import { NextResponse, type NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { isCrossSite } from "@/lib/media/upload-http";
import { getBackupManager } from "@/lib/db/backup";
import { authorizeBackupAdmin, backupFileResponse, describeBackupFailure } from "@/lib/db/backup-admin";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** 20260930-041522 (UTC), for download file names. */
function stamp(date: Date = new Date()): string {
  return date.toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
}

/**
 * GET /api/admin/backup?format=json|sqlite — download the live data as it
 * is right now, without keeping a copy on the server: a JSON export (the
 * default; the db.json format) or a compacted SQLite file. Both can be
 * restored from the admin data page or with `npm run db:restore`.
 *
 * Admin only. The file contains password hashes, sessions and payment
 * details.
 */
export async function GET(req: NextRequest) {
  if (isCrossSite(req)) return NextResponse.json({ ok: false, error: "Backups can only be downloaded from this site." }, { status: 403, headers: NO_STORE });
  const access = await authorizeBackupAdmin("download");
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status, headers: NO_STORE });

  const format = req.nextUrl.searchParams.get("format") === "sqlite" ? "sqlite" : "json";
  try {
    const manager = await getBackupManager();
    const { file, sizeBytes } = await manager.exportTo(format);
    await audit(access.user, "backup.download", { type: "settings", id: "data" }, { source: "live data", format, bytes: sizeBytes });
    return backupFileResponse(file, { downloadName: `learnloop-backup-${stamp()}.${format}`, format, sizeBytes, removeAfter: true });
  } catch (err) {
    const failure = describeBackupFailure(err, "The backup could not be prepared. Please try again.");
    return NextResponse.json({ ok: false, error: failure.error }, { status: failure.status, headers: NO_STORE });
  }
}
