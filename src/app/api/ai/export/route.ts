import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, isCreator } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { audit } from "@/lib/audit";
import { toCsv } from "@/components/admin/settings/member-import-csv";
import { filterReviewRows, parseReviewFilters, reviewRows, reviewRowsToTable } from "@/lib/ai/service";
import { toDateKey } from "@/lib/utils";

/**
 * GET /api/ai/export — CSV of the AI tutor answers matching the review queue
 * filters (`tab`, `course`, `feedback`, `q`, `days`). Course creators export
 * their own courses; moderators and admins export all of them.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!isCreator(user)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const params = req.nextUrl.searchParams;
  const filters = parseReviewFilters((key) => params.get(key) ?? undefined);
  const db = await getDb();
  const rows = filterReviewRows(reviewRows(db, user), filters);
  await audit(user, "ai.export", { type: "ai_message", id: filters.tab }, { rows: rows.length, courseId: filters.courseId ?? null });

  // BOM so spreadsheet apps detect UTF-8.
  const csv = `﻿${toCsv(reviewRowsToTable(rows))}`;
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ai-tutor-${filters.tab}-${toDateKey()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
