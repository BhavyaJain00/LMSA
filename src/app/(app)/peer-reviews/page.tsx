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
import { getT } from "@/i18n/server";

type Translate = Awaited<ReturnType<typeof getT<"learning">>>;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("learning");
  return { title: t("peer.title") };
}

function ReviewCard({ row, t }: { row: ReviewerQueueRow; t: Translate }) {
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
                {row.overdue ? t("peer.overdue") : t("peer.toDo")}
              </Badge>
            ) : (
              <Badge tone="success" dot>
                {t("peer.submitted")}
              </Badge>
            )}
            {row.usesRubric && <Badge tone="outline">{t("peer.rubric")}</Badge>}
            {row.anonymous && <Badge tone="outline">{t("peer.anonymous")}</Badge>}
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            {row.courseTitle ? `${row.courseTitle} · ` : ""}
            {open
              ? t.rich("peer.dueOn", { time: <LocalDateTime iso={row.dueAt} /> })
              : t.rich("peer.submittedOn", { time: <LocalDateTime iso={row.submittedAt ?? row.assignedAt} /> })}
          </p>
        </div>
        <ButtonLink href={`/peer-reviews/${row.id}`} variant={open ? "primary" : "outline"} size="sm" className="self-start sm:self-auto">
          {open ? t("peer.write") : t("peer.view")}
        </ButtonLink>
      </Card>
    </li>
  );
}

function FeedbackCard({ row, t }: { row: ReceivedFeedbackRow; t: Translate }) {
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
                {t("peer.received", { received: row.received, expected: Math.max(row.expected, row.received) })}
              </Badge>
            ) : (
              <Badge tone="neutral">{row.expected > 0 ? t("peer.reviewersAtWork") : t("peer.waitingForReviewers")}</Badge>
            )}
            {row.averagePercent !== null && <Badge tone="accent">{t("peer.average", { percent: row.averagePercent })}</Badge>}
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            {row.courseTitle ? `${row.courseTitle} · ` : ""}
            {row.lastReceivedAt ? t.rich("peer.latestFeedback", { time: <LocalDateTime iso={row.lastReceivedAt} /> }) : t("peer.notifyHint")}
          </p>
        </div>
        <ButtonLink href={row.href} variant={row.received > 0 ? "primary" : "outline"} size="sm" className="self-start sm:self-auto">
          {row.received > 0 ? t("peer.readFeedback") : t("peer.openAssignment")}
        </ButtonLink>
      </Card>
    </li>
  );
}

export default async function PeerReviewsPage(props: PageProps<"/peer-reviews">) {
  const user = await requireUser("/peer-reviews");
  await runPeerReviewSweep();
  const t = await getT("learning");
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
        title={t("peer.title")}
        description={
          todo.length
            ? overdue
              ? t("peer.toWriteOverdue", { count: todo.length, overdue })
              : t("peer.toWrite", { count: todo.length })
            : t("peer.intro")
        }
        actions={
          canManageAssessments(user) ? (
            <ButtonLink href="/peer-reviews/manage" variant="outline" leftIcon={<Icon.Settings className="size-4" />}>
              {t("peer.manage")}
            </ButtonLink>
          ) : undefined
        }
      />
      <Tabs
        className="mb-5"
        items={[
          { label: t("peer.tabTodo"), value: "todo", count: todo.length },
          { label: t("peer.tabDone"), value: "done", count: done.length },
          { label: t("peer.tabReceived"), value: "received", count: feedback.reduce((n, r) => n + r.received, 0) },
        ]}
      />
      {total === 0 ? (
        <EmptyState
          icon={tab === "done" ? <Icon.CheckCircle /> : tab === "received" ? <Icon.MessageSquare /> : <Icon.Inbox />}
          title={tab === "done" ? t("peer.emptyDoneTitle") : tab === "received" ? t("peer.emptyReceivedTitle") : t("peer.emptyTodoTitle")}
          description={tab === "done" ? t("peer.emptyDoneBody") : tab === "received" ? t("peer.emptyReceivedBody") : t("peer.emptyTodoBody")}
          action={
            <ButtonLink href="/dashboard" variant="outline">
              {t("peer.backToDashboard")}
            </ButtonLink>
          }
        />
      ) : (
        <>
          <ul className="space-y-3">
            {tab === "received"
              ? feedback.slice(0, limit).map((row) => <FeedbackCard key={row.assignmentId} row={row} t={t} />)
              : list.slice(0, limit).map((row) => <ReviewCard key={row.id} row={row} t={t} />)}
          </ul>
          <ListFooter shown={Math.min(limit, total)} total={total} size={size} pages={pages} />
        </>
      )}
    </div>
  );
}
