import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/session";
import { recordQuizSubmission } from "@/lib/data/quiz";
import type { SubmitQuizInput } from "@/components/quiz/types";

/**
 * Beacon endpoint: when a learner closes or refreshes the tab mid-attempt the
 * runner posts its answers here with `navigator.sendBeacon`, and the attempt
 * is graded and stored with the reason "Browser closed".
 */
export async function POST(req: NextRequest, ctx: RouteContext<"/quiz/[id]/submit">) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let body: Partial<SubmitQuizInput>;
  try {
    const text = await req.text();
    if (text.length > 1_000_000) return NextResponse.json({ ok: false, error: "Payload too large" }, { status: 413 });
    body = JSON.parse(text) as Partial<SubmitQuizInput>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }
  if (!body || typeof body !== "object") return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });

  const result = await recordQuizSubmission(user, {
    quizId: id,
    lessonId: typeof body.lessonId === "string" ? body.lessonId : undefined,
    courseId: typeof body.courseId === "string" ? body.courseId : undefined,
    questionIds: Array.isArray(body.questionIds) ? body.questionIds : [],
    answers: body.answers && typeof body.answers === "object" ? body.answers : {},
    startedAt: typeof body.startedAt === "string" ? body.startedAt : "",
    timeTakenSeconds: typeof body.timeTakenSeconds === "number" ? body.timeTakenSeconds : 0,
    violationCount: typeof body.violationCount === "number" ? body.violationCount : 0,
    submissionReason: "browser_closed",
    preview: false,
  });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });

  revalidatePath("/admin/quizzes/submissions");
  revalidatePath("/quiz/[id]", "page");
  revalidatePath("/courses/[slug]/learn/[ref]", "page");
  return NextResponse.json({ ok: true, id: result.data.submission.id });
}
