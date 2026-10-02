import { I18nProvider } from "@/i18n/provider";

/** Hands the dashboard's client components (streak dialog, error boundary) their `account` messages. */
export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  return (
    <I18nProvider namespaces={["account"]} pick={{ account: ["dashboard.streak.", "count.", "errors."] }}>
      {children}
    </I18nProvider>
  );
}
