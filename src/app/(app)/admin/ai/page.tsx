import type { Metadata } from "next";
import { isAdmin, requireRole } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { aiSiteStatus } from "@/lib/ai/access";
import { detachedClarifications, filterReviewRows, parseReviewFilters, reportReasons, reviewableCourses, reviewRows, reviewTabCounts, type ReviewTab } from "@/lib/ai/service";
import { isReportReason, REPORT_REASONS } from "@/lib/ai/reports";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/skeleton";
import { Icon } from "@/components/ui/icons";
import { Tabs } from "@/components/ui/tabs";
import { FilterBar, ListFooter } from "@/components/assessments/list-controls";
import { param, parsePaging } from "@/components/assessments/shared";
import { AiAdminHeader } from "@/components/ai/admin-header";
import { ReviewQueue, type ReviewQueueItem } from "@/components/ai/review-queue";
import { DetachedClarifications } from "@/components/ai/detached-clarifications";
import { stripMarkdown } from "@/lib/utils";

export const metadata: Metadata = { title: "AI tutor review" };

const TAB_LABELS: Record<ReviewTab, string> = {
  flagged: "Flagged",
  gaps: "Not covered",
  recent: "All answers",
  reviewed: "Reviewed",
};

const EMPTY_COPY: Record<ReviewTab, { title: string; description: string }> = {
  flagged: { title: "Nothing to review", description: "Answers learners mark as not helpful or report will appear here." },
  gaps: { title: "No gaps found", description: "Questions the tutor couldn't answer from the course material will appear here — they show what to add to your lessons." },
  recent: { title: "No questions yet", description: "When learners ask the AI tutor about your courses, their questions and the answers will appear here." },
  reviewed: { title: "No reviewed answers", description: "Answers you approve or correct will be listed here." },
};

export default async function AiReviewPage(props: PageProps<"/admin/ai">) {
  const user = await requireRole(["moderator", "course_creator"], "/admin/ai");
  const sp = await props.searchParams;
  const filters = parseReviewFilters((key) => param(sp[key]));
  const { size, pages, limit } = parsePaging(sp.size, sp.pages);

  const db = await getDb();
  const site = aiSiteStatus(db.settings);
  const all = reviewRows(db, user);
  const counts = reviewTabCounts(filterReviewRows(all, { ...filters, tab: "recent" }));
  const rows = filterReviewRows(all, filters);
  const shown = rows.slice(0, limit);
  const reasons = reportReasons(db, new Set(shown.map((r) => r.id)));

  const courseOptions = reviewableCourses(db, user)
    .filter((c) => c.aiTutorEnabled || all.some((r) => r.courseId === c.id))
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((c) => ({ value: c.id, label: c.title }));

  const items: ReviewQueueItem[] = shown.map((r) => {
    const reason = reasons.get(r.id);
    return {
      id: r.id,
      conversationId: r.conversationId,
      courseTitle: r.courseTitle,
      lessonTitle: r.lessonTitle,
      learnerName: r.learner?.name ?? "Deleted member",
      learnerAvatar: r.learner?.avatarUrl,
      question: r.question,
      answerText: stripMarkdown(r.answer).replace(/\s+/g, " ").trim(),
      answer: r.answer,
      createdAt: r.createdAt,
      helpful: r.helpful,
      flagged: r.flagged,
      unknown: r.unknown,
      reviewStatus: r.reviewStatus,
      instructorNote: r.instructorNote,
      reportReason: reason && isReportReason(reason) ? REPORT_REASONS[reason] : undefined,
    };
  });

  const exportQuery = new URLSearchParams();
  exportQuery.set("tab", filters.tab);
  if (filters.courseId) exportQuery.set("course", filters.courseId);
  if (filters.feedback) exportQuery.set("feedback", filters.feedback);
  if (filters.q) exportQuery.set("q", filters.q);
  if (filters.days) exportQuery.set("days", String(filters.days));
  const filtered = !!(filters.courseId || filters.feedback || filters.q || filters.days);
  const detached =
    filters.tab === "reviewed"
      ? detachedClarifications(db, user)
          .filter((c) => !filters.courseId || c.courseId === filters.courseId)
          .map(({ id, courseTitle, lessonTitle, text, authorName, updatedAt }) => ({ id, courseTitle, lessonTitle, text, authorName, updatedAt }))
      : [];
  const empty = EMPTY_COPY[filters.tab];

  return (
    <div className="animate-fade-in">
      <AiAdminHeader
        site={site}
        isAdmin={isAdmin(user)}
        description="Check what learners ask the tutor, approve good answers and correct the ones that missed. Corrections are shown to the learner and teach the tutor."
        actions={
          rows.length > 0 ? (
            <a href={`/api/ai/export?${exportQuery.toString()}`} className={buttonClasses({ variant: "outline", size: "sm" })} download>
              <Icon.Download className="size-4" /> Export CSV
            </a>
          ) : undefined
        }
      />

      <Tabs
        variant="pills"
        className="mb-4"
        items={(["flagged", "gaps", "recent", "reviewed"] as const).map((tab) => ({ label: TAB_LABELS[tab], value: tab, count: counts[tab] }))}
      />

      <FilterBar
        filters={[
          { param: "q", kind: "search", label: "Search", placeholder: "Search questions, answers, learners" },
          { param: "course", kind: "select", label: "Courses", options: courseOptions },
          {
            param: "feedback",
            kind: "select",
            label: "Feedback",
            placeholder: "Any feedback",
            options: [
              { value: "down", label: "Not helpful" },
              { value: "up", label: "Helpful" },
              { value: "none", label: "No feedback" },
            ],
          },
          {
            param: "days",
            kind: "select",
            label: "Period",
            placeholder: "All time",
            options: [
              { value: "7", label: "Last 7 days" },
              { value: "30", label: "Last 30 days" },
              { value: "90", label: "Last 90 days" },
            ],
          },
        ]}
      />

      {shown.length ? (
        <>
          <ReviewQueue items={items} />
          <ListFooter shown={shown.length} total={rows.length} size={size} pages={pages} noun="answers" />
        </>
      ) : (
        <EmptyState
          icon={filtered ? <Icon.Search /> : <Icon.Sparkles />}
          title={filtered ? "No answers match these filters" : empty.title}
          description={filtered ? "Try another course, period or search term." : empty.description}
        />
      )}

      <DetachedClarifications items={detached} />
    </div>
  );
}
