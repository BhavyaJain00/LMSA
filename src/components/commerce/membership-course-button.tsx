"use client";

import { useState, useTransition } from "react";
import { unstable_rethrow, useRouter } from "next/navigation";
import { joinCourseWithMembershipAction } from "@/lib/actions/plans";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { FormError } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

/**
 * "Start learning" on a course the viewer's membership includes: enrolls them
 * without a checkout and opens the first lesson.
 */
export function MembershipCourseButton({ slug, planName }: { slug: string; planName: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const start = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await joinCourseWithMembershipAction(slug);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        if (res.message) toast.success(res.message);
        router.push(res.data.href);
        router.refresh();
      } catch (failure) {
        // Signed-out visitors are redirected to the login page by the action.
        unstable_rethrow(failure);
        setError("The course could not be opened. Please check your connection and try again.");
      }
    });
  };

  return (
    <div className="space-y-2">
      <Button size="lg" className="w-full" loading={pending} onClick={start} leftIcon={<Icon.Play className="size-4" />}>
        {pending ? "Opening the course…" : "Start learning"}
      </Button>
      <p className="flex items-center justify-center gap-1.5 text-center text-xs text-ink-muted">
        <Icon.Star className="size-3.5 shrink-0 text-accent" aria-hidden="true" />
        Included in your {planName} membership
      </p>
      <FormError message={error} />
    </div>
  );
}
