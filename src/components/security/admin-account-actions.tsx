import type { ComponentProps } from "react";
import { AccountI18n } from "@/components/dashboard/account-i18n";
import { AdminAccountActionsClient, type AdminAccountActionKey } from "./admin-account-actions-client";

export type { AdminAccountActionKey };

/** Admin buttons for one account, with the `account` messages they need (they render on admin pages). */
export function AdminAccountActions(props: ComponentProps<typeof AdminAccountActionsClient>) {
  return (
    <AccountI18n slices={["security.admin."]}>
      <AdminAccountActionsClient {...props} />
    </AccountI18n>
  );
}
