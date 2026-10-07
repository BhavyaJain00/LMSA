import type { ReactNode } from "react";
import { I18nProvider } from "@/i18n/provider";
import { ROUTE_PROVIDED_GLOBALS } from "@/i18n/provided";

/**
 * Server component that provides the video and audio player's messages
 * (`learning` → `global.player.*`) to the client components below it. The
 * root layout leaves them out (about 125 strings that most pages never use),
 * so every layout or page that renders `VideoPlayer` or `AudioPlayer` wraps
 * its content in this: the lesson player group, course and batch detail
 * pages, and the admin lesson editor. Nested providers merge key by key, so
 * wrapping twice is harmless.
 *
 * Do not import this from `./index.ts`: the player barrel is client code.
 */
export function PlayerI18n({ children }: { children: ReactNode }) {
  return (
    <I18nProvider namespaces={["learning"]} pick={{ learning: ROUTE_PROVIDED_GLOBALS.learning ?? [] }}>
      {children}
    </I18nProvider>
  );
}
