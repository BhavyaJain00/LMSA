"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/types";
import { enrollAction } from "@/lib/actions/enrollment";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";

/** "Start learning" button: enrolls the viewer in a free course (redirects to the lesson on success). */
export function EnrollButton({ slug, label = "Start learning" }: { slug: string; label?: string }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(enrollAction, null);
  return (
    <form action={formAction} className="flex flex-col items-center gap-3">
      <input type="hidden" name="slug" value={slug} />
      <Button type="submit" loading={pending} size="lg" leftIcon={<Icon.Play className="size-4" />}>
        {label}
      </Button>
      <FormError message={state && !state.ok ? state.error : null} />
    </form>
  );
}
