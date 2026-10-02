"use client";

import { RouteError } from "@/components/admin/settings/route-error";
import { useT } from "@/i18n/client";

/**
 * Backup & restore could not be shown: usually the backups folder cannot be
 * read or the database cannot be opened. The command-line tools work
 * without the app, so they are offered as the way out.
 */
export default function DataSettingsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT("admin");
  return (
    <div className="space-y-4">
      <RouteError error={error} reset={reset} title={t("errorPages.backups")} backHref="/admin/settings/general" backLabel={t("errorPages.backToSettings")} />
      <p className="mx-auto max-w-xl rounded-lg border border-border bg-surface-2/60 px-4 py-3 text-sm text-ink-muted">
        {t.rich("errorPages.backupsCli", {
          list: (chunks) => (
            <code dir="ltr" className="font-mono text-[13px] text-ink">
              {chunks}
            </code>
          ),
          restore: (chunks) => (
            <code dir="ltr" className="font-mono text-[13px] text-ink">
              {chunks}
            </code>
          ),
        })}
      </p>
    </div>
  );
}
