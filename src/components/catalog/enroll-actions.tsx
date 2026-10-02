"use client";

import { startTransition, useActionState, useState, type ReactNode } from "react";
import type { ActionResult } from "@/lib/types";
import { claimCertificateAction, enrollAction, unenrollAction } from "@/lib/actions/enrollment";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { FormError } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/i18n/client";

/**
 * "Enroll for free" button. Guests are redirected to the login page by the
 * action (with a warning toast) and brought back to the course afterwards;
 * refusals (unpublished, payment required, …) are shown under the button.
 */
export function EnrollButton({
  slug,
  label,
  variant = "primary",
  icon,
}: {
  slug: string;
  label?: string;
  variant?: ButtonVariant;
  icon?: ReactNode;
}) {
  const t = useT("public");
  // Bound directly to the server action so enrolling also works before hydration.
  const [state, action, pending] = useActionState(enrollAction, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="slug" value={slug} />
      <Button type="submit" size="lg" variant={variant} className="w-full" loading={pending} leftIcon={icon ?? <Icon.BookOpen className="size-4" />}>
        {pending ? t("enroll.enrolling") : (label ?? t("enroll.enrollFree"))}
      </Button>
      <FormError message={state && !state.ok ? state.error : null} />
    </form>
  );
}

/** Subtle "Get certificate" button shown when the free certificate can be claimed. */
export function ClaimCertificateButton({ slug }: { slug: string }) {
  const t = useT("public");
  const [state, action, pending] = useActionState(claimCertificateAction, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="slug" value={slug} />
      <Button type="submit" variant="subtle" className="w-full" loading={pending} leftIcon={<Icon.GraduationCap className="size-4" />}>
        {t("enroll.getCertificate")}
      </Button>
      <FormError message={state && !state.ok ? state.error : null} />
    </form>
  );
}

/** "Leave course" link with a confirmation dialog (self-enrolled, free courses only). */
export function LeaveCourseButton({ slug, courseTitle }: { slug: string; courseTitle: string }) {
  const t = useT("public");
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [, action, pending] = useActionState(async (prev: ActionResult | null, formData: FormData) => {
    const result = await unenrollAction(prev, formData);
    if (!result.ok) {
      toast.error(t("enroll.leave.failed"), result.error);
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
        <Icon.LogOut className="size-3.5 rtl:rotate-180" aria-hidden="true" />
        {t("enroll.leave.button")}
      </button>
      <ConfirmDialog
        open={open}
        onClose={() => (pending ? undefined : setOpen(false))}
        onConfirm={confirm}
        loading={pending}
        destructive
        title={t("enroll.leave.title")}
        description={t("enroll.leave.description", { title: courseTitle })}
        confirmLabel={t("enroll.leave.button")}
      />
    </>
  );
}
