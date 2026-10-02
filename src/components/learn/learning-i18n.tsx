import type { ReactNode } from "react";
import { I18nProvider } from "@/i18n/provider";

/**
 * Server component that hands slices of the `learning` namespace to the
 * client components below it. The quiz, assessment and AI tutor components
 * also render on pages other groups own (admin lists, editors and grading
 * screens), whose layouts do not provide `learning`; their server entry
 * points wrap themselves in this so `useT("learning")` works wherever they
 * are mounted. Nested providers merge key by key, so wrapping twice is harmless.
 */
export function LearningI18n({ slices, children }: { slices: readonly string[]; children: ReactNode }) {
  return (
    <I18nProvider namespaces={["learning"]} pick={{ learning: slices }}>
      {children}
    </I18nProvider>
  );
}
