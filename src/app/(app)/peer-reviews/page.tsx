import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { canManageAssessments } from "@/lib/data/assessments";
import { listReceivedFeedback, listReviewerQueue, runPeerReviewSweep, type ReceivedFeedbackRow, type ReviewerQueueRow } from "@/lib/teaching/peer-review";
import { Card, PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/skeleton";
import { Tabs } from "@/components/ui/tabs";
import { Icon } from "@/components/ui/icons";
import { LocalDateTime } from "@/components/assessments/client-time";
import { ListFooter } from "@/components/assessments/list-controls";
import { param, parsePaging } from "@/components/assessments/shared";

export const metadata: Metadata = { title: "Peer reviews" };

function ReviewCard({ row }: { row: ReviewerQueueRow }) {
  const open = row.status === "assigned";
  return (
    <li>
      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/peer-reviews/${row.id}`} className="font-medium text-ink hover:underline">
              {row.assignmentTitle}
            </Link>
            {open ? (
              <Badge tone={row.overdue ? "danger" : "warning"} dot>
                {row.overdue ? "Overdue" : "To do"}
              </Badge>
            ) : (
              <Badge tone="success" dot>
                Submitted
              </Badge>
            )}
            {row.usesRubric && <Badge tone="outline">Rubric</Badge>}
            {row.anonymous && <Badge tone="outline">Anonymous</Badge>}
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            {row.courseTitle ? `${row.courseTitle} · ` : ""}
            {open ? (
              <>
                Due <LocalDateTime iso={row.dueAt} />
              </>
            ) : (
              <>
                Submitted <LocalDateTime iso={row.submittedAt ?? row.assignedAt} />
              </>
            )}
          </p>
        </div>
        <ButtonLink href={`/peer-reviews/${row.id}`} variant={open ? "primary" : "outline"} size="sm" className="self-start sm:self-auto">
          {open ? "Write review" : "View review"}
        </ButtonLink>
      </Card>
    </li>
  );
}

function FeedbackCard({ row }: { row: ReceivedFeedbackRow }) {
  return (
    <li>
      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={row.href} className="font-medium text-ink hover:underline">
              {row.assignmentTitle}
            </Link>
            {row.received > 0 ? (
              <Badge tone={row.received >= row.expected ? "success" : "info"} dot>
                {row.received} of {Math.max(row.expected, row.received)} received
              </Badge>
            ) : (
              <Badge tone="neutral">{row.expected > 0 ? "Reviewers at work" : "Waiting for reviewers"}</Badge>
            )}
            {row.averagePercent !== null && <Badge tone="accent">Peer average {row.averagePercent}%</Badge>}
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            {row.courseTitle ? `${row.courseTitle} · ` : ""}
            {row.lastReceivedAt ? (
              <>
                Latest feedback <LocalDateTime iso={row.lastReceivedAt} />
              </>
            ) : (
              "You'll get a notification when feedback arrives."
            )}
          </p>
        </div>
        <ButtonLink href={row.href} variant={row.received > 0 ? "primary" : "outline"} size="sm" className="self-start sm:self-auto">
          {row.received > 0 ? "Read feedback" : "Open assignment"}
        </ButtonLink>
      </Card>
    </li>
  );
}

export default async function PeerReviewsPage(props: PageProps<"/peer-reviews">) {
  const user = await requireUser("/peer-reviews");
  await runPeerReviewSweep();
  const sp = await props.searchParams;
  const requested = param(sp.tab);
  const tab = requested === "done" || requested === "received" ? requested : "todo";
  const { size, pages, limit } = parsePaging(sp.size, sp.pages);

  const [rows, feedback] = await Promise.all([listReviewerQueue(user.id), listReceivedFeedback(user.id)]);
  const todo = rows.filter((r) => r.status === "assigned");
  const done = rows.filter((r) => r.status === "submitted");
  const list = tab === "done" ? done : todo;
  const total = tab === "received" ? feedback.length : list.length;
  const overdue = todo.filter((r) => r.overdue).length;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Peer reviews"
        description={
          todo.length
            ? `You have ${todo.length} ${todo.length === 1 ? "review" : "reviews"} to write${overdue ? `, ${overdue} overdue` : ""}.`
            : "Give classmates feedback on their assignments. New reviews show up here when they're handed out."
        }
        actions={
          canManageAssessments(user) ? (
            <ButtonLink href="/peer-reviews/manage" variant="outline" leftIcon={<Icon.Settings className="size-4" />}>
              Manage peer reviews
            </ButtonLink>
          ) : undefined
        }
      />
      <Tabs
        className="mb-5"
        items={[
          { label: "To do", value: "todo", count: todo.length },
          { label: "Submitted", value: "done", count: done.length },
          { label: "Feedback for me", value: "received", count: feedback.reduce((n, r) => n + r.received, 0) },
        ]}
      />
      {total === 0 ? (
        <EmptyState
          icon={tab === "done" ? <Icon.CheckCircle /> : tab === "received" ? <Icon.MessageSquare /> : <Icon.Inbox />}
          title={tab === "done" ? "No submitted reviews yet" : tab === "received" ? "No feedback yet" : "You're all caught up"}
          description={
            tab === "done"
              ? "Reviews you submit are listed here. You can update one until the instructor grades that work."
              : tab === "received"
                ? "Feedback classmates give on your assignments is collected here."
                : "When you submit an assignment with peer review, you'll be asked to review a few classmates' work here."
          }
          action={
            <ButtonLink href="/dashboard" variant="outline">
              Back to dashboard
            </ButtonLink>
          }
        />
      ) : (
        <>
          <ul className="space-y-3">
            {tab === "received"
              ? feedback.slice(0, limit).map((row) => <FeedbackCard key={row.assignmentId} row={row} />)
              : list.slice(0, limit).map((row) => <ReviewCard key={row.id} row={row} />)}
          </ul>
          <ListFooter shown={Math.min(limit, total)} total={total} size={size} pages={pages} noun={tab === "received" ? "assignments" : "reviews"} />
        </>
      )}
    </div>
  );
}
