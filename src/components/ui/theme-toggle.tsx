"use client";

import { Icon } from "./icons";
import { IconButton } from "./button";
import { useT } from "@/i18n/client";

export type Theme = "light" | "dark";

const STORAGE_KEY = "ll-theme";

/** Inline script that applies the saved theme before first paint (avoids a flash). */
export const themeInitScript = `(function(){try{var t=localStorage.getItem("${STORAGE_KEY}");if(!t){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.setAttribute("data-theme",t)}catch(e){}})();`;

export function getTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

export function setTheme(t: Theme): void {
  document.documentElement.setAttribute("data-theme", t);
  try {
    localStorage.setItem(STORAGE_KEY, t);
  } catch {
    /* ignore */
  }
}

/**
 * Theme switch. The icon is chosen with CSS (`dark:` variant) so the
 * component needs no state and never mismatches during hydration.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const t = useT("common");
  return (
    <IconButton label={t("a11y.toggleTheme")} onClick={() => setTheme(getTheme() === "dark" ? "light" : "dark")} className={className}>
      <Icon.Moon className="size-5 dark:hidden" />
      <Icon.Sun className="hidden size-5 dark:block" />
    </IconButton>
  );
}
