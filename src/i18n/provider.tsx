import type { ReactNode } from "react";
import type { Namespace } from "./config";
import { I18nClientProvider } from "./client";
import { clientMessages, getLocale } from "./server";

/**
 * Server component that makes namespaces available to `useT()` in the client
 * components below it. Put it in the layout (or page) that renders those
 * components. The root layout already provides `common`, `shell` and the
 * `global.` keys of every other namespace; the auth layout provides `auth`.
 *
 *   <I18nProvider namespaces={["learning"]}>{children}</I18nProvider>
 *
 * Only the listed namespaces are serialized, already merged with English.
 * For a large namespace, `pick` limits it to key prefixes (nested providers
 * merge key by key, so a slice never hides keys provided higher up):
 *
 *   <I18nProvider namespaces={["admin"]} pick={{ admin: ["courses.", "editor."] }}>
 */
export async function I18nProvider({ namespaces, pick, children }: { namespaces: readonly Namespace[]; pick?: Partial<Record<Namespace, readonly string[]>>; children: ReactNode }) {
  const locale = await getLocale();
  return (
    <I18nClientProvider locale={locale} messages={clientMessages(locale, namespaces, pick)}>
      {children}
    </I18nClientProvider>
  );
}
