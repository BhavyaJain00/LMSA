import type { ComponentProps } from "react";
import { PublicI18n } from "@/components/catalog/public-i18n";
import { JobForm as JobFormClient } from "./job-form-client";

export type { JobFormValues } from "./job-form-values";

/** Create / edit a job opening; see `./job-form-client.tsx`. Provides its messages (it is also used on admin pages). */
export function JobForm(props: ComponentProps<typeof JobFormClient>) {
  return (
    <PublicI18n pick={["jobs.form.", "jobs.type.", "jobs.mode.", "jobs.status."]}>
      <JobFormClient {...props} />
    </PublicI18n>
  );
}
