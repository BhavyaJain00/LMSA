import { I18nProvider } from "@/i18n/provider";

/** Hands the account settings pages' client components (forms, dialogs, error boundaries) their `account` messages. */
export default function SettingsLayout({ children }: LayoutProps<"/settings">) {
  return (
    <I18nProvider namespaces={["account"]} pick={{ account: ["settings.", "theme.", "security.devices.", "security.setup.", "security.manage.", "security.codes.", "security.copy."] }}>
      {children}
    </I18nProvider>
  );
}
