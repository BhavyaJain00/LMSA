"use client";

import { useActionState, useState, type FormEvent } from "react";
import type { ActionResult, Review } from "@/lib/types";
import { createReviewAction, updateReviewAction } from "@/lib/actions/reviews";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Label, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { StarRatingInput } from "./star-rating-input";

const MAX_LENGTH = 2000;

export interface ReviewDraft {
  id: string;
  rating: number;
  review: string;
}

function ReviewForm({ courseSlug, courseTitle, existing, onDone }: { courseSlug: string; courseTitle: string; existing?: ReviewDraft | null; onDone: () => void }) {
  const toast = useToast();
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [text, setText] = useState(existing?.review ?? "");
  const [clientError, setClientError] = useState<string | null>(null);

  const [state, formAction, pending] = useActionState(async (prev: ActionResult<Review> | null, formData: FormData) => {
    const result = existing ? await updateReviewAction(prev, formData) : await createReviewAction(prev, formData);
    if (result.ok) {
      toast.success(result.message ?? "Review saved");
      onDone();
    }
    return result;
  }, null);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    if (!rating) {
      e.preventDefault();
      setClientError("Please enter a rating.");
      return;
    }
    setClientError(null);
  };

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  const ratingError = clientError ?? fieldErrors?.rating;
  const formError = state && !state.ok && !fieldErrors?.rating ? state.error : null;

  return (
    <form action={formAction} onSubmit={onSubmit} className="space-y-5" noValidate>
      <input type="hidden" name="slug" value={courseSlug} />
      {existing && <input type="hidden" name="reviewId" value={existing.id} />}
      <p className="text-sm text-ink-muted">
        How would you rate <span className="font-medium text-ink">{courseTitle}</span>?
      </p>
      <FormError message={formError} />
      <div>
        <Label required>Rating</Label>
        <StarRatingInput
          value={rating}
          onChange={(n) => {
            setRating(n);
            setClientError(null);
          }}
          invalid={!!ratingError}
          describedBy={ratingError ? "review-rating-error" : undefined}
        />
        {ratingError && (
          <p id="review-rating-error" className="mt-1.5 text-xs text-danger">
            {ratingError}
          </p>
        )}
      </div>
      <Field
        label="Review"
        htmlFor="review-text"
        error={fieldErrors?.review}
        hint={`${text.length}/${MAX_LENGTH} · What did you like? What could be better?`}
      >
        <Textarea
          id="review-text"
          name="review"
          rows={5}
          maxLength={MAX_LENGTH}
          value={text}
          onChange={(e) => setText(e.target.value)}
          invalid={!!fieldErrors?.review}
          placeholder="Share your experience with other learners"
        />
      </Field>
      <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
        <Button variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" loading={pending}>
          {existing ? "Save changes" : "Submit"}
        </Button>
      </div>
    </form>
  );
}

/** "Write a Review" / "Edit your review" modal. */
export function ReviewDialog({
  open,
  onClose,
  courseSlug,
  courseTitle,
  existing,
}: {
  open: boolean;
  onClose: () => void;
  courseSlug: string;
  courseTitle: string;
  existing?: ReviewDraft | null;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={existing ? "Edit your review" : "Write a Review"} size="md">
      {open && <ReviewForm courseSlug={courseSlug} courseTitle={courseTitle} existing={existing} onDone={onClose} />}
    </Dialog>
  );
}
