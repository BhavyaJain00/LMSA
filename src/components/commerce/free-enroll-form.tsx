"use client";

import { useActionState } from "react";
import { enrollAction } from "@/lib/actions/enrollment";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/input";
import { useT } from "@/i18n/client";

/** "Enroll for Free" for items that turn out not to need a payment (uses the direct enroll action). */
export function FreeEnrollForm({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState(enrollAction, null);
  const t = useT("account");
  return (
    <form action={action} className="mt-5 space-y-3">
      <input type="hidden" name="slug" value={slug} />
      <FormError message={state && !state.ok ? state.error : null} />
      <Button type="submit" className="w-full" loading={pending}>
        {t("commerce.freeEnroll")}
      </Button>
    </form>
  );
}
