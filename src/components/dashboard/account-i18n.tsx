import type { ReactNode } from "react";
import { I18nProvider } from "@/i18n/provider";

/**
 * Server component that hands slices of the `account` namespace to the client
 * components below it. Account components that also render on pages owned by
 * other groups (admin settings, the catalog, auth screens) wrap themselves in
 * this from a small server entry point, so `useT("account")` works wherever
 * they are mounted. Nested providers merge key by key, so wrapping twice is
 * harmless.
 */
export function AccountI18n({ slices, children }: { slices: readonly string[]; children: ReactNode }) {
  return (
    <I18nProvider namespaces={["account"]} pick={{ account: slices }}>
      {children}
    </I18nProvider>
  );
}
