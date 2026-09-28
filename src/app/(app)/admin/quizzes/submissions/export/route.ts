import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, isCreator } from "@/lib/auth/session";
import { getScopedSubmissionMap, listQuizSubmissions, submissionsToCsv, type SubmissionFilters } from "@/lib/data/quiz";
import { toDateKey } from "@/lib/utils";
import type { SubmissionStatus } from "@/components/quiz/types";

const STATUSES: SubmissionStatus[] = ["pending", "passed", "failed"];

/**
 * CSV export of quiz submissions, honouring the same filters as the list
 * (?quiz=&member=&course=&status=). Instructors get the quizzes they manage;
 * moderators get everything.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent("/admin/quizzes/submissions")}`, req.url));
  if (!isCreator(user)) return new NextResponse("Forbidden", { status: 403 });

  const params = req.nextUrl.searchParams;
  const status = params.get("status") ?? "";
  const filters: SubmissionFilters = {
    quiz: params.get("quiz") || undefined,
    member: params.get("member") || undefined,
    course: params.get("course") || undefined,
    status: STATUSES.includes(status as SubmissionStatus) ? (status as SubmissionStatus) : "",
  };

  const [items, raw] = await Promise.all([listQuizSubmissions(user, filters), getScopedSubmissionMap(user)]);
  // Leading BOM so spreadsheet apps detect UTF-8.
  const csv = "﻿" + submissionsToCsv(items, raw);
  const filename = `quiz-submissions-${toDateKey()}.csv`;
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
