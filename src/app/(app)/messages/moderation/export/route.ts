import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { audit } from "@/lib/audit";
import { isMessageModerator } from "@/lib/comms/messages-core";
import { reportCsvRows } from "@/lib/comms/messages";
import { toCsv } from "@/components/admin/settings/member-import-csv";
import { toDateKey } from "@/lib/utils";

/** CSV of every reported conversation (open and resolved) the moderator may review (never their own). Moderators and admins; message bodies are not exported. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent("/messages/moderation")}`, req.url));
  if (!isMessageModerator(user)) return new NextResponse("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
  const rows = reportCsvRows(await getDb(), user.id);
  await audit(user, "message.report_export", undefined, { reports: rows.length - 1 });
  // Leading BOM so spreadsheet apps detect UTF-8.
  return new NextResponse("﻿" + toCsv(rows), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="message-reports-${toDateKey()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
