import type { ComponentProps } from "react";
import { AccountI18n } from "@/components/dashboard/account-i18n";
import { LoginEventsFiltersClient, type LoginEventFilterValues } from "./login-events-filters-client";

export type { LoginEventFilterValues };

/** URL-driven filters for the admin login activity table, with the `account` messages they need. */
export function LoginEventsFilters(props: ComponentProps<typeof LoginEventsFiltersClient>) {
  return (
    <AccountI18n slices={["security.filters."]}>
      <LoginEventsFiltersClient {...props} />
    </AccountI18n>
  );
}
