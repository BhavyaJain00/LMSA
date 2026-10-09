"use client";

import { Icon } from "./icons";
import { IconButton } from "./button";
import { useT } from "@/i18n/client";

import { DEFAULT_THEME, THEME_STORAGE_KEY as STORAGE_KEY, type Theme } from "./theme";

export { DEFAULT_THEME, themeInitScript, type Theme } from "./theme";

export function getTheme(): Theme {
  if (typeof document === "undefined") return DEFAULT_THEME;
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
