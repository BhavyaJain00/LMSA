"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { deleteReviewAction } from "@/lib/actions/reviews";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { useFormatter, useT } from "@/i18n/client";
import { RatingStars } from "./rating-stars";
import { ReviewDialog, type ReviewDraft } from "./review-dialog";
import type { ReviewView } from "./types";

const INITIAL_VISIBLE = 4;
const CLAMP_AT = 220;

export interface RatingSummary {
  average: number | null;
  count: number;
  buckets: Record<1 | 2 | 3 | 4 | 5, number>;
}

function ReviewText({ text }: { text: string }) {
  const t = useT("public");
  const [expanded, setExpanded] = useState(false);
  if (!text) return <p className="text-sm italic text-ink-faint">{t("reviews.noText")}</p>;
  const long = text.length > CLAMP_AT;
  return (
    <div>
      <p className={cn("whitespace-pre-line text-sm leading-6 text-ink-muted", long && !expanded && "line-clamp-5")}>{text}</p>
      {long && (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-1 text-sm font-medium text-accent hover:underline" aria-expanded={expanded}>
          {expanded ? t("reviews.seeLess") : t("reviews.seeMore")}
        </button>
      )}
    </div>
  );
}

function ReviewItem({
  review,
  canModerate,
  onEdit,
  onDelete,
}: {
  review: ReviewView;
  canModerate: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useT("public");
  const common = useT("common");
  const profile = review.author.username ? `/user/${review.author.username}` : null;
  return (
    <article className={cn("flex gap-3 rounded-card p-4", review.isOwn ? "border border-accent/30 bg-accent/5" : "border border-border bg-surface-1")}>
      {profile ? (
        <Link href={profile} className="shrink-0 rounded-full" aria-label={t("course.instructors.profileOf", { name: review.author.name })}>
          <Avatar name={review.author.name} src={review.author.avatarUrl} size="md" />
        </Link>
      ) : (
        <Avatar name={review.author.name} src={review.author.avatarUrl} size="md" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2">
              {profile ? (
                <Link href={profile} className="truncate font-medium text-ink hover:text-accent hover:underline">
                  {review.author.name}
                </Link>
              ) : (
                <span className="truncate font-medium text-ink">{review.author.name}</span>
              )}
              {review.isOwn && (
                <Badge tone="accent" size="xs">
                  {t("reviews.yours")}
                </Badge>
              )}
            </p>
            <div className="mt-1 flex items-center gap-2">
              <RatingStars value={review.rating} size="xs" />
              <time dateTime={review.createdAt} className="text-xs text-ink-faint">
                {review.dateLabel}
              </time>
            </div>
          </div>
          {(review.isOwn || canModerate) && (
            <div className="-me-1 -mt-1 flex items-center gap-0.5">
              {review.isOwn && (
                <Button variant="ghost" size="xs" onClick={onEdit} leftIcon={<Icon.Edit className="size-3.5" />}>
                  {common("actions.edit")}
                </Button>
              )}
              <Button variant="ghost" size="xs" onClick={onDelete} className="text-danger hover:bg-danger/10" leftIcon={<Icon.Trash className="size-3.5" />}>
                {common("actions.delete")}
              </Button>
            </div>
          )}
        </div>
        <div className="mt-2">
          <ReviewText text={review.review} />
        </div>
      </div>
    </article>
  );
}

/**
 * Reviews block of the course page: rating summary with a clickable
 * breakdown (filters the list), the review list ("View all reviews",
 * "See more"), and the write / edit / delete flows.
 */
export function ReviewsPanel({
  courseSlug,
  courseTitle,
  summary,
  reviews,
  canWrite,
  writeHint,
  canModerate,
}: {
  courseSlug: string;
  courseTitle: string;
  summary: RatingSummary;
  reviews: ReviewView[];
  /** Enrolled learner without a review yet. */
  canWrite: boolean;
  /** Explains why the viewer cannot write a review (shown under the summary). */
  writeHint?: string | null;
  canModerate: boolean;
}) {
  const t = useT("public");
  const common = useT("common");
  const f = useFormatter();
  const toast = useToast();
  const [dialog, setDialog] = useState<{ open: boolean; existing: ReviewDraft | null }>({ open: false, existing: null });
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState<number | null>(null);
  const [toDelete, setToDelete] = useState<ReviewView | null>(null);
  const [deleting, startDelete] = useTransition();

  const own = reviews.find((r) => r.isOwn) ?? null;
  const others = reviews.filter((r) => !r.isOwn);
  const filtered = filter ? others.filter((r) => r.rating === filter) : others;
  const visible = showAll ? filtered : filtered.slice(0, INITIAL_VISIBLE);
  const average = summary.average ?? 0;

  const confirmDelete = () => {
    if (!toDelete) return;
    const target = toDelete;
    startDelete(async () => {
      const formData = new FormData();
      formData.set("reviewId", target.id);
      const result = await deleteReviewAction(null, formData);
      if (result.ok) {
        toast.success(result.message ?? t("reviews.deleted"));
        setToDelete(null);
      } else {
        toast.error(t("reviews.deleteFailed"), result.error);
      }
    });
  };

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3 justify-between">
        <h2 className="text-2xl font-semibold tracking-tight text-ink">{t("reviews.title")}</h2>
        {canWrite && (
          <Button onClick={() => setDialog({ open: true, existing: null })} leftIcon={<Icon.Star className="size-4" />}>
            {t("reviews.write")}
          </Button>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
        <div className="rounded-card border border-border bg-surface-1 p-5">
          <div className="flex items-center gap-2">
            <Icon.StarFilled className="size-7 text-warning" aria-hidden="true" />
            <span className="text-4xl font-semibold tracking-tight text-ink">
              {summary.count ? f.number(average, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : f.number(0)}
            </span>
          </div>
          <RatingStars value={average} size="sm" className="mt-2" />
          <p className="mt-1 text-sm text-ink-muted">{t("reviews.summary", { count: summary.count })}</p>
          {summary.count > 0 && (
            <ul className="mt-4 space-y-1" aria-label={t("reviews.breakdown")}>
              {([5, 4, 3, 2, 1] as const).map((star) => {
                const n = summary.buckets[star];
                const pct = summary.count ? Math.round((n / summary.count) * 100) : 0;
                const active = filter === star;
                return (
                  <li key={star}>
                    <button
                      type="button"
                      disabled={n === 0}
                      onClick={() => {
                        setFilter(active ? null : star);
                        setShowAll(false);
                      }}
                      aria-pressed={active}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-xs transition-colors",
                        active ? "bg-accent/10 text-ink" : "text-ink-muted hover:bg-surface-2",
                        n === 0 && "cursor-default opacity-60 hover:bg-transparent",
                      )}
                    >
                      <span className="inline-flex w-7 shrink-0 items-center gap-0.5 tabular-nums">
                        {star}
                        <Icon.StarFilled className="size-3 text-warning" aria-hidden="true" />
                      </span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
                        <span className="block h-full rounded-full bg-warning" style={{ width: `${pct}%` }} />
                      </span>
                      <span className="w-9 shrink-0 text-end tabular-nums">{f.percent(pct)}</span>
                      <span className="sr-only">
                        {active ? t("reviews.bucketActive", { count: n, stars: star }) : t("reviews.bucket", { count: n, stars: star })}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {writeHint && <p className="mt-4 border-t border-border pt-3 text-xs text-ink-muted">{writeHint}</p>}
        </div>

        <div className="min-w-0 space-y-4">
          {own && (
            <ReviewItem
              review={own}
              canModerate={canModerate}
              onEdit={() => setDialog({ open: true, existing: { id: own.id, rating: own.rating, review: own.review } })}
              onDelete={() => setToDelete(own)}
            />
          )}

          {filter && (
            <div className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-muted">
              <span>{t("reviews.filtered", { count: filtered.length, stars: filter })}</span>
              <button type="button" onClick={() => setFilter(null)} className="font-medium text-accent hover:underline">
                {t("reviews.showAll")}
              </button>
            </div>
          )}

          {visible.length > 0 ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {visible.map((review) => (
                <ReviewItem key={review.id} review={review} canModerate={canModerate} onEdit={() => undefined} onDelete={() => setToDelete(review)} />
              ))}
            </div>
          ) : (
            !own && (
              <EmptyState
                compact
                icon={<Icon.MessageSquare />}
                title={t("reviews.emptyTitle")}
                description={canWrite ? t("reviews.emptyCanWrite") : t("reviews.emptyDescription")}
                action={
                  canWrite ? (
                    <Button size="sm" onClick={() => setDialog({ open: true, existing: null })}>
                      {t("reviews.write")}
                    </Button>
                  ) : undefined
                }
              />
            )
          )}

          {!showAll && filtered.length > INITIAL_VISIBLE && (
            <Button variant="outline" className="w-full" onClick={() => setShowAll(true)}>
              {t("reviews.viewAll", { count: filtered.length })}
            </Button>
          )}
        </div>
      </div>

      <ReviewDialog
        open={dialog.open}
        onClose={() => setDialog({ open: false, existing: null })}
        courseSlug={courseSlug}
        courseTitle={courseTitle}
        existing={dialog.existing}
      />
      <ConfirmDialog
        open={!!toDelete}
        onClose={() => (deleting ? undefined : setToDelete(null))}
        onConfirm={confirmDelete}
        loading={deleting}
        destructive
        title={toDelete?.isOwn ? t("reviews.deleteOwnTitle") : t("reviews.deleteTitle")}
        description={
          toDelete?.isOwn
            ? t("reviews.deleteOwnDescription")
            : toDelete
              ? t("reviews.deleteDescription", { name: toDelete.author.name })
              : t("reviews.deleteDescriptionAnonymous")
        }
        confirmLabel={common("actions.delete")}
      />
    </div>
  );
}
