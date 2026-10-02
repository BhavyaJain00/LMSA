import { I18nProvider } from "@/i18n/provider";

/** The API reference's client parts (endpoint browser, code samples) read the `developers.` messages. */
export default function DevelopersLayout({ children }: LayoutProps<"/developers">) {
  return (
    <I18nProvider namespaces={["admin"]} pick={{ admin: ["developers.", "errorPages."] }}>
      {children}
    </I18nProvider>
  );
}
