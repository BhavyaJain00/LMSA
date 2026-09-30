import { NextResponse, type NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { isCrossSite } from "@/lib/media/upload-http";
import { getBackupManager } from "@/lib/db/backup";
import { authorizeBackupAdmin, backupFileResponse } from "@/lib/db/backup-admin";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET /api/admin/backup/<name> — download a backup stored on the server
 * (`storage/backups`). `<name>` must be a backup file name as listed on the
 * admin data page; anything else (including paths) is answered with 404.
 * Admin only.
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/admin/backup/[name]">) {
  if (isCrossSite(req)) return NextResponse.json({ ok: false, error: "Backups can only be downloaded from this site." }, { status: 403, headers: NO_STORE });
  const access = await authorizeBackupAdmin("download");
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status, headers: NO_STORE });

  const { name } = await ctx.params;
  const manager = await getBackupManager();
  const entry = manager.find(name);
  if (!entry) return NextResponse.json({ ok: false, error: "That backup no longer exists." }, { status: 404, headers: NO_STORE });

  await audit(access.user, "backup.download", { type: "settings", id: "data" }, { name: entry.name, kind: entry.kind, bytes: entry.sizeBytes });
  return backupFileResponse(entry.file, { downloadName: entry.name, format: entry.format, sizeBytes: entry.sizeBytes });
}
