"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { setTheme } from "@/components/ui/theme-toggle";
import { Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

export type ThemePreference = "system" | "light" | "dark";

/** Same key the shared ThemeToggle and the pre-paint init script use. */
const STORAGE_KEY = "ll-theme";
const CHANGE_EVENT = "ll-theme-preference";

function readPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    observer.disconnect();
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

const systemDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

/** Apply a preference: explicit light/dark is stored; "system" clears it and follows the OS. */
export function applyThemePreference(pref: ThemePreference): void {
  if (pref === "system") {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable */
    }
    document.documentElement.setAttribute("data-theme", systemDark() ? "dark" : "light");
  } else {
    setTheme(pref);
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Current preference (null during SSR/hydration). */
export function useThemePreference(): ThemePreference | null {
  return useSyncExternalStore<ThemePreference | null>(subscribe, readPreference, () => null);
}

/** While the preference is "system", follow OS changes live. */
function useFollowSystem(pref: ThemePreference | null) {
  useEffect(() => {
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => document.documentElement.setAttribute("data-theme", mq.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);
}

const options: { value: ThemePreference; label: string; description: string; icon: React.ReactNode }[] = [
  { value: "system", label: "System", description: "Match your device setting", icon: <Icon.Monitor className="size-5" /> },
  { value: "light", label: "Light", description: "Bright surfaces, dark text", icon: <Icon.Sun className="size-5" /> },
  { value: "dark", label: "Dark", description: "Easy on the eyes at night", icon: <Icon.Moon className="size-5" /> },
];

export const themeLabels: Record<ThemePreference, string> = { system: "System", light: "Light", dark: "Dark" };

/** Three radio cards (used on the account settings page). */
export function ThemePreferenceControl() {
  const pref = useThemePreference();
  useFollowSystem(pref);
  return (
    <div role="radiogroup" aria-label="Colour mode" className="grid gap-3 sm:grid-cols-3">
      {options.map((o) => {
        const checked = pref === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={checked}
            onClick={() => applyThemePreference(o.value)}
            className={cn(
              "flex items-start gap-3 rounded-xl border p-3 text-left transition-colors",
              checked ? "border-accent bg-accent/5 ring-1 ring-accent" : "border-border hover:bg-surface-2",
            )}
          >
            <span className={cn("mt-0.5", checked ? "text-accent" : "text-ink-muted")}>{o.icon}</span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ink">{o.label}</span>
              <span className="block text-xs text-ink-muted">{o.description}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Settings-style row that opens a "Colour mode" bottom sheet (used on the mobile You page). */
export function ColourModeRow({ className }: { className?: string }) {
  const pref = useThemePreference();
  const [open, setOpen] = useState(false);
  useFollowSystem(pref);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className} aria-haspopup="dialog">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-muted">
          <Icon.Sun className="size-4 dark:hidden" />
          <Icon.Moon className="hidden size-4 dark:block" />
        </span>
        <span className="min-w-0 flex-1 text-left text-sm text-ink">Colour mode</span>
        <span className="text-sm text-ink-muted">{pref ? themeLabels[pref] : ""}</span>
        <Icon.ChevronRight className="size-4 shrink-0 text-ink-faint rtl:rotate-180" />
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Colour mode"
        description="Applies to this device only."
        size="sm"
        className="max-sm:mb-0 max-sm:max-w-full max-sm:rounded-b-none"
      >
        <ul className="-mx-2" role="radiogroup" aria-label="Colour mode">
          {options.map((o) => {
            const checked = pref === o.value;
            return (
              <li key={o.value}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  onClick={() => {
                    applyThemePreference(o.value);
                    setOpen(false);
                  }}
                  className="flex min-h-12 w-full items-center gap-3 rounded-lg px-2 text-left hover:bg-surface-2"
                >
                  <span className="text-ink-muted">{o.icon}</span>
                  <span className="flex-1 text-sm text-ink">{o.label}</span>
                  {checked && <Icon.Check className="size-4 text-accent" />}
                </button>
              </li>
            );
          })}
        </ul>
      </Dialog>
    </>
  );
}
