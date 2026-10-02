import { NextResponse } from "next/server";
import { getCurrentUser, isModerator } from "@/lib/auth/session";
import { MEMBER_IMPORT_TEMPLATE } from "@/components/admin/settings/member-import-csv";

/** GET /admin/members/import/template — the member import CSV template (moderators). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!isModerator(user)) return NextResponse.json({ ok: false, error: "Your role can't manage members." }, { status: 403 });
  return new NextResponse(`﻿${MEMBER_IMPORT_TEMPLATE}\r\n`, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="members-import-template.csv"',
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
