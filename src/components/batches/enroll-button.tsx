"use client";

import { enrollInBatchAction } from "@/lib/actions/batches";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { useActionForm } from "./hooks";
import { useT } from "@/i18n/client";

/** "Enroll Now" for free batches with self-enrollment (redirects on success). */
export function EnrollButton({ batchId, label }: { batchId: string; label?: string }) {
  const t = useT("public");
  const { onSubmit, pending, error } = useActionForm(enrollInBatchAction);
  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <input type="hidden" name="batchId" value={batchId} />
      <FormError message={error} />
      <Button type="submit" size="lg" className="w-full" loading={pending} leftIcon={<Icon.GraduationCap className="size-5" />}>
        {label ?? t("batches.panel.enrollNow")}
      </Button>
    </form>
  );
}
