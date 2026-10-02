import { AccountI18n } from "@/components/dashboard/account-i18n";

/** Hands the `commerce.` messages that the checkout, order and invoice client components read to the browser. */
export default function BillingLayout({ children }: LayoutProps<"/billing">) {
  return <AccountI18n slices={["commerce."]}>{children}</AccountI18n>;
}
