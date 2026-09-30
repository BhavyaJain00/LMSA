"use client";

import type { ReactNode } from "react";
import { openConsentSettings } from "./consent-client";
import { cn } from "@/lib/utils";

/**
 * "Cookie settings" link for footers and the cookie policy: reopens the
 * consent dialog so visitors can change or withdraw their choice at any time.
 * Rendered as a button (it performs an action, it does not navigate).
 */
export function CookieSettingsLink({ className, children = "Cookie settings" }: { className?: string; children?: ReactNode }) {
  return (
    <button
      type="button"
      onClick={openConsentSettings}
      aria-haspopup="dialog"
      className={cn("cursor-pointer rounded-sm text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40", className)}
    >
      {children}
    </button>
  );
}
