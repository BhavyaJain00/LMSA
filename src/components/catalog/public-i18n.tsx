import type { ReactNode } from "react";
import { I18nProvider } from "@/i18n/provider";

/**
 * Hands slices of the `public` messages to client components of the public
 * group that are rendered on pages it doesn't lay out (admin screens, profile
 * pages). Server wrappers next to those components render it, so the pages
 * that import them need no change:
 *
 *   export function PostsTable(props: ComponentProps<typeof Client>) {
 *     return <PublicI18n pick={["blogAdmin."]}><Client {...props} /></PublicI18n>;
 *   }
 *
 * Inside the public group's own layouts the namespace is already provided;
 * nesting is harmless (providers merge key by key).
 */
export function PublicI18n({ pick, children }: { pick: readonly string[]; children: ReactNode }) {
  return (
    <I18nProvider namespaces={["public"]} pick={{ public: pick }}>
      {children}
    </I18nProvider>
  );
}
