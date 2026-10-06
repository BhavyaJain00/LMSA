"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { approveAnswersAction } from "@/lib/actions/ai";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { cn, relativeTime } from "@/lib/utils";
import { ThumbDownIcon, ThumbUpIcon } from "./ai-icons";
import { ReviewActions } from "./review-actions";

export interface ReviewQueueItem {
  id: string;
  conversationId: string;
  courseTitle: string;
  lessonTitle?: string;
  learnerName: string;
  learnerAvatar?: string;
  question: string;
  /** Answer as plain text (markdown stripped). */
  answerText: string;
  answer: string;
  createdAt: string;
  helpful?: boolean;
  flagged: boolean;
  unknown: boolean;
  reviewStatus?: "pending" | "approved" | "corrected";
  instructorNote?: string;
  reportReason?: string;
}

/** Review queue list: answer cards with bulk approve. */
export function ReviewQueue({ items }: { items: ReviewQueueItem[] }) {
  const router = useRouter();
  const toast = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const selectable = items.filter((i) => i.reviewStatus !== "approved");
  const visibleSelected = selectable.filter((i) => selected.has(i.id));
  const allSelected = selectable.length > 0 && visibleSelected.length === selectable.length;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const approveSelected = () => {
    const ids = visibleSelected.map((i) => i.id);
    if (!ids.length) return;
    startTransition(async () => {
      const result = await approveAnswersAction(ids);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "Approved");
      setSelected(new Set());
      router.refresh();
    });
  };

  return (
    <div>
      {selectable.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface-1 px-3 py-2">
          <Checkbox
            checked={allSelected}
            onChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map((i) => i.id)))}
            label={visibleSelected.length ? `${visibleSelected.length} selected` : "Select all on this page"}
          />
          <Button size="sm" variant="outline" disabled={!visibleSelected.length} loading={pending} onClick={approveSelected} leftIcon={<Icon.Check className="size-4" />}>
            Approve selected
          </Button>
        </div>
      )}
      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.id}>
            <article
              aria-labelledby={`review-q-${item.id}`}
              className={cn("rounded-card border bg-surface-1 p-4 shadow-card sm:p-5", selected.has(item.id) ? "border-accent/60 ring-1 ring-accent/40" : "border-border")}
            >
              <div className="flex items-start gap-3">
                {item.reviewStatus !== "approved" && (
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    onChange={() => toggle(item.id)}
                    aria-label={`Select the answer to “${item.question.slice(0, 60)}”`}
                    className="mt-1 size-4 shrink-0 accent-[var(--accent)]"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
                    <span className="inline-flex items-center gap-1.5 font-medium text-ink">
                      <Avatar name={item.learnerName} src={item.learnerAvatar} size="xs" />
                      {item.learnerName}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="truncate">
                      {item.courseTitle}
                      {item.lessonTitle ? ` › ${item.lessonTitle}` : ""}
                    </span>
                    <span aria-hidden="true">·</span>
                    <time dateTime={item.createdAt}>{relativeTime(item.createdAt)}</time>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {item.flagged && (
                      <Badge tone="danger" dot>
                        Flagged
                      </Badge>
                    )}
                    {item.unknown && <Badge tone="warning">Not covered by the course</Badge>}
                    {item.helpful === true && (
                      <Badge tone="success">
                        <ThumbUpIcon className="size-3" /> Helpful
                      </Badge>
                    )}
                    {item.helpful === false && (
                      <Badge tone="danger">
                        <ThumbDownIcon className="size-3" /> Not helpful
                      </Badge>
                    )}
                    {item.reviewStatus === "approved" && <Badge tone="success">Approved</Badge>}
                    {item.reviewStatus === "corrected" && <Badge tone="info">Corrected</Badge>}
                    {item.reviewStatus === "pending" && <Badge tone="neutral">Awaiting review</Badge>}
                  </div>
                  <h3 id={`review-q-${item.id}`} className="mt-3 whitespace-pre-wrap break-words text-sm font-semibold text-ink">
                    {item.question || "(question unavailable)"}
                  </h3>
                  <p className="mt-1.5 line-clamp-3 break-words text-sm text-ink-muted">{item.answerText}</p>
                  {item.reportReason && (
                    <p className="mt-2 flex items-center gap-1.5 text-xs text-danger">
                      <Icon.AlertCircle className="size-3.5" /> Reported: {item.reportReason}
                    </p>
                  )}
                  {item.reviewStatus === "corrected" && item.instructorNote && (
                    <p className="mt-2 line-clamp-2 rounded-lg bg-info/8 px-3 py-2 text-xs text-ink">
                      <span className="font-semibold text-info">Correction: </span>
                      {item.instructorNote}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <ReviewActions
                      messageId={item.id}
                      question={item.question}
                      answer={item.answer}
                      reviewStatus={item.reviewStatus}
                      instructorNote={item.instructorNote}
                      size="xs"
                    />
                    <Link
                      href={`/admin/ai/conversations/${item.conversationId}?message=${item.id}#m-${item.id}`}
                      className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                    >
                      Full conversation <Icon.ArrowRight className="size-3.5 rtl:rotate-180" />
                    </Link>
                  </div>
                </div>
              </div>
            </article>
          </li>
        ))}
      </ul>
    </div>
  );
}
