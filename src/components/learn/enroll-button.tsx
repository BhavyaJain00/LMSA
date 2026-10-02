"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/types";
import { enrollAction } from "@/lib/actions/enrollment";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { useT } from "@/i18n/client";

/**
 * "Start learning" button: enrolls the viewer in a free course. On success the
 * action redirects to `returnTo` (a lesson of the same course) or, without it,
 * to the first unlocked lesson.
 */
export function EnrollButton({ slug, returnTo, label }: { slug: string; returnTo?: string; label?: string }) {
  const t = useT("learning");
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(enrollAction, null);
  return (
    <form action={formAction} className="flex flex-col items-center gap-3">
      <input type="hidden" name="slug" value={slug} />
      {returnTo && <input type="hidden" name="next" value={returnTo} />}
      <Button type="submit" loading={pending} size="lg" leftIcon={<Icon.Play className="size-4" />}>
        {label ?? t("learn.enroll.start")}
      </Button>
      <FormError message={state && !state.ok ? state.error : null} />
    </form>
  );
}
