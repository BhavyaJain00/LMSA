"use client";

import { startTransition, useActionState, useState, type ReactNode } from "react";
import type { ActionResult } from "@/lib/types";
import { claimCertificateAction, enrollAction, unenrollAction } from "@/lib/actions/enrollment";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { FormError } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

/**
 * "Enroll for free" button. Guests are redirected to the login page by the
 * action (with a warning toast) and brought back to the course afterwards;
 * refusals (unpublished, payment required, …) are shown under the button.
 */
export function EnrollButton({
  slug,
  label = "Enroll for free",
  variant = "primary",
  icon,
}: {
  slug: string;
  label?: string;
  variant?: ButtonVariant;
  icon?: ReactNode;
}) {
  // Bound directly to the server action so enrolling also works before hydration.
  const [state, action, pending] = useActionState(enrollAction, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="slug" value={slug} />
      <Button type="submit" size="lg" variant={variant} className="w-full" loading={pending} leftIcon={icon ?? <Icon.BookOpen className="size-4" />}>
        {pending ? "Enrolling…" : label}
      </Button>
      <FormError message={state && !state.ok ? state.error : null} />
    </form>
  );
}

/** Subtle "Get certificate" button shown when the free certificate can be claimed. */
export function ClaimCertificateButton({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState(claimCertificateAction, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="slug" value={slug} />
      <Button type="submit" variant="subtle" className="w-full" loading={pending} leftIcon={<Icon.GraduationCap className="size-4" />}>
        Get Certificate
      </Button>
      <FormError message={state && !state.ok ? state.error : null} />
    </form>
  );
}

/** "Leave course" link with a confirmation dialog (self-enrolled, free courses only). */
export function LeaveCourseButton({ slug, courseTitle }: { slug: string; courseTitle: string }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [, action, pending] = useActionState(async (prev: ActionResult | null, formData: FormData) => {
    const result = await unenrollAction(prev, formData);
    if (!result.ok) {
      toast.error("Could not leave the course", result.error);
      setOpen(false);
    }
    return result;
  }, null);

  const confirm = () => {
    const formData = new FormData();
    formData.set("slug", slug);
    startTransition(() => action(formData));
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted hover:text-danger hover:underline"
      >
        <Icon.LogOut className="size-3.5" aria-hidden="true" />
        Leave course
      </button>
      <ConfirmDialog
        open={open}
        onClose={() => (pending ? undefined : setOpen(false))}
        onConfirm={confirm}
        loading={pending}
        destructive
        title="Leave this course?"
        description={`You will be unenrolled from ${courseTitle} and your lesson progress will be deleted. You can enroll again later, but you will start from the beginning.`}
        confirmLabel="Leave course"
      />
    </>
  );
}
