import "server-only";
import type { ReactNode } from "react";
import { englishMessages } from "@/i18n/catalog";
import { I18nProvider } from "@/i18n/provider";

/**
 * Slices of the `admin` namespace that client components read. Keys under
 * `pages.` are only rendered by Server Components (page headings, metadata,
 * server-built labels), so they are never serialized for the browser.
 */
const SERVER_ONLY = new Set(["pages", "global"]);

let cached: string[] | null = null;

/** Top-level key prefixes of the `admin` namespace that client components need. */
export function adminClientSlices(): string[] {
  if (!cached) {
    const prefixes = new Set<string>();
    for (const key of Object.keys(englishMessages("admin"))) {
      const head = key.slice(0, key.indexOf("."));
      if (head && !SERVER_ONLY.has(head)) prefixes.add(`${head}.`);
    }
    cached = [...prefixes].sort();
  }
  return cached;
}

/**
 * Provides the client slices of `admin` to a subtree outside /admin (for
 * example /developers), where the admin layout does not apply.
 */
export function AdminI18n({ children }: { children: ReactNode }) {
  return (
    <I18nProvider namespaces={["admin"]} pick={{ admin: adminClientSlices() }}>
      {children}
    </I18nProvider>
  );
}
