import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { canManageAssessments } from "@/lib/data/assessments";
import { getDb } from "@/lib/db/store";
import { peerReviewsCsv } from "@/lib/teaching/peer-review";
import { slugify, toDateKey } from "@/lib/utils";

/**
 * GET /peer-reviews/manage/[assignmentId]/export — every peer review of the
 * assignment as CSV (reviewer, author, status, a column per rubric criterion,
 * total, comment). Staff only; the export is audited.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: RouteContext<"/peer-reviews/manage/[assignmentId]/export">) {
  const { assignmentId } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(`/peer-reviews/manage/${assignmentId}`)}`, req.url));
  if (!canManageAssessments(user)) return new NextResponse("You are not permitted to export peer reviews.", { status: 403 });

  const db = await getDb();
  const assignment = db.assignments.find((a) => a.id === assignmentId);
  const csv = assignment ? await peerReviewsCsv(assignment.id) : null;
  if (!assignment || csv === null) return new NextResponse("Peer review is off for this assignment.", { status: 404 });

  await audit(user, "peer_review.export", { type: "assignment", id: assignment.id }, { rows: Math.max(0, csv.split("\r\n").length - 1) });
  const name = `peer-reviews-${slugify(assignment.title) || assignment.id}-${toDateKey()}.csv`;
  // BOM so spreadsheet apps detect UTF-8.
  return new NextResponse(`﻿${csv}`, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
