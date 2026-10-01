"use client";

import { useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { LOCALES, LOCALE_INFO, type Locale } from "@/i18n/config";
import { useLocale, useT } from "@/i18n/client";
import { setLocaleFormAction } from "@/lib/actions/locale";
import { Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

/**
 * Language switchers. All of them submit `setLocaleFormAction` (cookie +
 * account preference), so they also work before JavaScript loads; the page
 * re-renders in the new language, `<html lang dir>` included.
 */

function CompactSelect({ locale, label }: { locale: Locale; label: string }) {
  const { pending } = useFormStatus();
  return (
    <span className="relative inline-flex items-center">
      <Icon.Globe className={cn("pointer-events-none absolute inset-s-2 size-4 text-ink-faint", pending && "animate-pulse")} aria-hidden="true" />
      <select
        key={locale}
        name="locale"
        defaultValue={locale}
        aria-label={label}
        aria-busy={pending || undefined}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="h-8 cursor-pointer appearance-none rounded-lg border border-border bg-surface-1 ps-7.5 pe-7 text-xs font-medium text-ink-muted transition-colors hover:border-border-strong hover:text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
      >
        {LOCALES.map((code) => (
          <option key={code} value={code} lang={code} dir={LOCALE_INFO[code].dir}>
            {LOCALE_INFO[code].nativeName}
          </option>
        ))}
      </select>
      <Icon.ChevronDown className="pointer-events-none absolute inset-e-2 size-3.5 text-ink-faint" aria-hidden="true" />
    </span>
  );
}

/** Small globe + select for the auth screens and the site footer. */
export function LanguageSelect({ className }: { className?: string }) {
  const locale = useLocale();
  const t = useT("common");
  return (
    <form action={setLocaleFormAction} className={cn("inline-flex items-center gap-1.5", className)}>
      <CompactSelect locale={locale} label={t("language.choose")} />
      <noscript>
        <button type="submit" className="h-8 rounded-lg border border-border px-2 text-xs font-medium text-ink-muted hover:text-ink">
          {t("language.apply")}
        </button>
      </noscript>
    </form>
  );
}

function OptionButton({ code, active }: { code: Locale; active: boolean }) {
  const { pending, data } = useFormStatus();
  const submitting = pending && data?.get("locale") === code;
  const info = LOCALE_INFO[code];
  return (
    <button
      type="submit"
      name="locale"
      value={code}
      aria-pressed={active}
      disabled={pending}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-start transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait",
        active ? "border-accent bg-accent/8 text-ink" : "border-border bg-surface-1 text-ink hover:border-border-strong hover:bg-surface-2",
      )}
    >
      <span className="min-w-0 flex-1">
        <span lang={code} dir={info.dir} className="block text-sm font-medium">
          {info.nativeName}
        </span>
        {info.nativeName !== info.englishName && <span className="block text-xs text-ink-muted">{info.englishName}</span>}
      </span>
      {submitting ? (
        <Icon.Loader className="size-4 shrink-0 animate-spin text-ink-muted" aria-hidden="true" />
      ) : active ? (
        <Icon.CheckCircleFilled className="size-5 shrink-0 text-accent" aria-hidden="true" />
      ) : (
        <Icon.Circle className="size-5 shrink-0 text-ink-faint" aria-hidden="true" />
      )}
    </button>
  );
}

/** Every language as a selectable card (account settings, the account-menu dialog). */
export function LanguageOptions({ className, columns = 2 }: { className?: string; columns?: 1 | 2 }) {
  const locale = useLocale();
  const t = useT("common");
  return (
    <form action={setLocaleFormAction} className={className}>
      <fieldset>
        <legend className="sr-only">{t("language.choose")}</legend>
        <ul className={cn("grid gap-2", columns === 2 && "sm:grid-cols-2")}>
          {LOCALES.map((code) => (
            <li key={code}>
              <OptionButton code={code} active={code === locale} />
            </li>
          ))}
        </ul>
      </fieldset>
    </form>
  );
}

/** Dialog with the language list, opened from the account menu. Closes once the new language is active. */
export function LanguageDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const locale = useLocale();
  const t = useT("common");
  const openedWith = useRef<Locale | null>(null);

  // Remember the language the dialog opened with; close once the switch has landed.
  useEffect(() => {
    if (!open) openedWith.current = null;
    else if (openedWith.current === null) openedWith.current = locale;
    else if (locale !== openedWith.current) onClose();
  }, [open, locale, onClose]);

  return (
    <Dialog open={open} onClose={onClose} title={t("language.change")} description={t("language.settingsDescription")} size="sm">
      <LanguageOptions columns={1} />
    </Dialog>
  );
}
