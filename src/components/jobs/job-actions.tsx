import type { ComponentProps } from "react";
import { PublicI18n } from "@/components/catalog/public-i18n";
import {
  JobRowActions as JobRowActionsClient,
  JobStatusButton as JobStatusButtonClient,
  WithdrawApplicationButton as WithdrawApplicationButtonClient,
} from "./job-actions-client";

/* Job buttons and menus; see `./job-actions-client.tsx`. These wrappers provide their messages (the row menu is also used on an admin page). */

const PICK = ["jobs.actions.", "jobs.withdraw."] as const;

export function JobRowActions(props: ComponentProps<typeof JobRowActionsClient>) {
  return (
    <PublicI18n pick={PICK}>
      <JobRowActionsClient {...props} />
    </PublicI18n>
  );
}

export function JobStatusButton(props: ComponentProps<typeof JobStatusButtonClient>) {
  return (
    <PublicI18n pick={PICK}>
      <JobStatusButtonClient {...props} />
    </PublicI18n>
  );
}

export function WithdrawApplicationButton(props: ComponentProps<typeof WithdrawApplicationButtonClient>) {
  return (
    <PublicI18n pick={PICK}>
      <WithdrawApplicationButtonClient {...props} />
    </PublicI18n>
  );
}
