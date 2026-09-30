import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { loadReviewConversation } from "@/lib/ai/service";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { AnswerBody, CitationChips, InstructorNote } from "@/components/ai/chat-message";
import { ThumbDownIcon, ThumbUpIcon } from "@/components/ai/ai-icons";
import { ReviewActions } from "@/components/ai/review-actions";
import { citedNumbers } from "@/lib/ai/prompt";
import { cn, formatDateTime, formatNumber } from "@/lib/utils";

export const metadata: Metadata = { title: "AI tutor conversation", robots: { index: false } };

export default async function AiConversationReviewPage(props: PageProps<"/admin/ai/conversations/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const focus = typeof sp.message === "string" ? sp.message : null;
  const user = await requireRole(["moderator", "course_creator"], `/admin/ai/conversations/${id}`);
  const db = await getDb();
  const data = loadReviewConversation(db, user, id);
  if (!data) notFound();

  const { conversation, course, learner, lessonTitle, lessonHref, messages } = data;
  const answers = messages.filter((m) => m.role === "assistant");
  const tokens = answers.reduce((n, m) => n + (m.tokensIn ?? 0) + (m.tokensOut ?? 0), 0);

  return (
    <div className="animate-fade-in">
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Admin", href: "/admin" },
              { label: "AI tutor", href: "/admin/ai" },
              { label: "Conversation" },
            ]}
          />
        }
        title={conversation.title}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{course.title}</span>
            {lessonTitle && (
              <>
                <span aria-hidden="true">›</span>
                {lessonHref ? (
                  <Link href={lessonHref} className="hover:text-ink hover:underline">
                    {lessonTitle}
                  </Link>
                ) : (
                  <span>{lessonTitle}</span>
                )}
              </>
            )}
          </span>
        }
        actions={
          <ButtonLink href={`/admin/ai?course=${course.id}&tab=recent`} variant="outline" size="sm" leftIcon={<Icon.ArrowLeft className="size-4" />}>
            Back to the queue
          </ButtonLink>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <ol className="min-w-0 space-y-4" aria-label="Messages">
          {messages.map((m) => {
            const focused = focus === m.id;
            if (m.role === "user") {
              return (
                <li key={m.id} id={`m-${m.id}`} className="flex justify-end scroll-mt-24">
                  <div className="max-w-[88%]">
                    <div className="whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-accent px-3.5 py-2.5 text-sm text-accent-fg">{m.content}</div>
                    <p className="mt-1 text-right text-[11px] text-ink-faint">{formatDateTime(m.createdAt)}</p>
                  </div>
                </li>
              );
            }
            const cited = new Set(citedNumbers(m.content, m.citations.length));
            return (
              <li
                key={m.id}
                id={`m-${m.id}`}
                className={cn("scroll-mt-24 rounded-card border bg-surface-1 p-4 shadow-card sm:p-5", focused ? "border-accent ring-2 ring-accent/30" : "border-border")}
              >
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 inline-flex items-center gap-1.5 text-xs font-semibold text-ink">
                    <Icon.Sparkles className="size-3.5 text-accent" /> AI tutor
                  </span>
                  {m.flagged && (
                    <Badge tone="danger" dot>
                      Flagged
                    </Badge>
                  )}
                  {m.unknown && <Badge tone="warning">Not covered by the course</Badge>}
                  {m.helpful === true && (
                    <Badge tone="success">
                      <ThumbUpIcon className="size-3" /> Helpful
                    </Badge>
                  )}
                  {m.helpful === false && (
                    <Badge tone="danger">
                      <ThumbDownIcon className="size-3" /> Not helpful
                    </Badge>
                  )}
                  {m.reviewStatus === "pending" && <Badge tone="neutral">Awaiting review</Badge>}
                  {m.reviewStatus === "approved" && <Badge tone="success">Approved</Badge>}
                </div>
                <AnswerBody content={m.content} citations={m.citations} />
                <CitationChips citations={m.citations.filter((c) => cited.has(c.n))} />
                <InstructorNote message={m} />
                {m.reportReason && (
                  <p className="mt-3 flex items-center gap-1.5 text-xs text-danger">
                    <Icon.AlertCircle className="size-3.5" /> Reported by the learner: {m.reportReason}
                  </p>
                )}
                {m.citations.length > 0 && (
                  <details className="mt-3 rounded-lg border border-border bg-surface-2/40 px-3 py-2 text-xs">
                    <summary className="cursor-pointer font-medium text-ink-muted">Course excerpts sent with this question ({m.citations.length})</summary>
                    <ol className="mt-2 space-y-2">
                      {m.citations.map((c) => (
                        <li key={c.n} className="text-ink-muted">
                          <span className="font-semibold text-ink">
                            [{c.n}] {c.title}
                            {c.detail ? ` · ${c.detail}` : ""}
                          </span>
                          <span className="block">{c.snippet}</span>
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                  <ReviewActions
                    messageId={m.id}
                    question={previousQuestion(messages, m.id)}
                    answer={m.content}
                    reviewStatus={m.reviewStatus}
                    instructorNote={m.instructorNote}
                  />
                  <span className="text-[11px] tabular-nums text-ink-faint">
                    {formatDateTime(m.createdAt)}
                    {m.tokensIn || m.tokensOut ? ` · ${formatNumber((m.tokensIn ?? 0) + (m.tokensOut ?? 0))} tokens` : ""}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>

        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <div className="rounded-card border border-border bg-surface-1 p-4 shadow-card">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Learner</p>
            {learner ? (
              <Link href={`/user/${learner.username}`} className="mt-2 flex items-center gap-2.5 text-sm font-medium text-ink hover:text-accent">
                <Avatar name={learner.name} src={learner.avatarUrl} size="sm" />
                {learner.name}
              </Link>
            ) : (
              <p className="mt-2 text-sm text-ink-muted">Deleted member</p>
            )}
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-muted">Started</dt>
                <dd className="text-right text-ink">{formatDateTime(conversation.createdAt)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-muted">Answers</dt>
                <dd className="tabular-nums text-ink">{answers.length}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-muted">Tokens</dt>
                <dd className="tabular-nums text-ink">{formatNumber(tokens)}</dd>
              </div>
            </dl>
          </div>
          <p className="px-1 text-xs text-ink-faint">
            Corrections appear under the answer for this learner and are added to the tutor&apos;s material as an instructor clarification for everyone in the course.
          </p>
        </aside>
      </div>
    </div>
  );
}

/** The learner question an answer replied to. */
function previousQuestion(messages: { id: string; role: string; content: string }[], answerId: string): string {
  const index = messages.findIndex((m) => m.id === answerId);
  for (let i = index - 1; i >= 0; i--) if (messages[i]!.role === "user") return messages[i]!.content;
  return "";
}
