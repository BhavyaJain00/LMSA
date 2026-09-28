import type { ReactNode } from "react";
import type { Course } from "@/lib/types";
import { formatPrice } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { EnrollButton } from "./enroll-button";

export interface NoPreviewCardProps {
  course: Pick<Course, "id" | "slug" | "title" | "paidCourse" | "price" | "currency" | "disableSelfLearning" | "upcoming" | "published">;
  lessonTitle: string;
  loggedIn: boolean;
  /** The viewer already paid for the course (enrollment still pending). */
  hasPaid: boolean;
  loginHref: string;
  signupHref: string | null;
  /** Guest access to preview lessons is turned off in settings. */
  guestAccessDisabled: boolean;
}

/**
 * Card shown instead of the lesson content when the viewer may not open it:
 * explains why and offers the right next step (enroll, buy, log in, or
 * contact the administrator).
 */
export function NoPreviewCard({ course, lessonTitle, loggedIn, hasPaid, loginHref, signupHref, guestAccessDisabled }: NoPreviewCardProps) {
  const paid = course.paidCourse && course.price > 0;

  let action: ReactNode;
  if (!loggedIn) {
    action = (
      <div className="flex flex-wrap items-center justify-center gap-2">
        <ButtonLink href={loginHref} size="lg" leftIcon={<Icon.LogIn className="size-4" />}>
          Log in
        </ButtonLink>
        {signupHref && (
          <ButtonLink href={signupHref} size="lg" variant="outline">
            Create an account
          </ButtonLink>
        )}
      </div>
    );
  } else if (course.upcoming) {
    action = (
      <Badge tone="info" size="md">
        Enrollment opens soon. Check back when the course is live.
      </Badge>
    );
  } else if (course.disableSelfLearning) {
    action = (
      <Badge tone="info" size="md" className="whitespace-normal text-center">
        Contact the Administrator to enroll for this course.
      </Badge>
    );
  } else if (paid && !hasPaid) {
    action = (
      <div className="flex flex-wrap items-center justify-center gap-2">
        <ButtonLink href={`/billing/course/${course.id}`} size="lg" leftIcon={<Icon.CreditCard className="size-4" />}>
          Buy this course · {formatPrice(course.price, course.currency)}
        </ButtonLink>
        <ButtonLink href={`/courses/${course.slug}`} size="lg" variant="outline">
          Course details
        </ButtonLink>
      </div>
    );
  } else {
    action = <EnrollButton slug={course.slug} />;
  }

  return (
    <div className="mx-auto w-full max-w-xl py-6 sm:py-10">
      <div className="rounded-card border border-border bg-surface-1 p-6 text-center shadow-card sm:p-8">
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-surface-2 text-ink-muted">
          <Icon.Lock className="size-6" />
        </span>
        <h1 className="mt-4 text-lg font-semibold text-ink">This lesson is locked</h1>
        <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">
          {!loggedIn && guestAccessDisabled
            ? "Log in to access the lessons of this course."
            : "This lesson is not available for preview. Please enroll in the course to access it."}
        </p>
        <p className="mt-3 text-xs text-ink-faint">
          {lessonTitle} · {course.title}
        </p>
        <div className="mt-6 flex justify-center">{action}</div>
      </div>
    </div>
  );
}
