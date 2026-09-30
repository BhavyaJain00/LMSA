import { NextResponse } from "next/server";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { exportDatabase } from "@/lib/db/store";
import { audit } from "@/lib/audit";
import { toDateKey } from "@/lib/utils";

/**
 * GET /api/admin/backup — download a JSON snapshot of the whole database.
 * Admin only. The snapshot contains password hashes and payment details.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(user)) return NextResponse.json({ ok: false, error: "Only administrators can download backups." }, { status: 403 });

  const json = await exportDatabase();
  await audit(user, "backup.download", { type: "settings", id: "data" }, { bytes: json.length });
  return new NextResponse(json, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="learnloop-backup-${toDateKey()}.json"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
