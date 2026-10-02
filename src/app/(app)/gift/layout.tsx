import { AccountI18n } from "@/components/dashboard/account-i18n";

/** Hands the `commerce.` messages that the gift checkout form (a client component) reads to the browser. */
export default function GiftLayout({ children }: LayoutProps<"/gift">) {
  return <AccountI18n slices={["commerce."]}>{children}</AccountI18n>;
}
