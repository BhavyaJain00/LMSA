"use client";

import { RouteError } from "@/components/admin/settings/route-error";

/**
 * Backup & restore could not be shown: usually the backups folder cannot be
 * read or the database cannot be opened. The command-line tools work
 * without the app, so they are offered as the way out.
 */
export default function DataSettingsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="space-y-4">
      <RouteError error={error} reset={reset} title="Backups could not be loaded" backHref="/admin/settings/general" backLabel="Back to settings" />
      <p className="mx-auto max-w-xl rounded-lg border border-border bg-surface-2/60 px-4 py-3 text-sm text-ink-muted">
        The backups can also be managed on the server, without the app: <code className="font-mono text-[13px] text-ink">npm run db:backup -- --list</code> lists them and{" "}
        <code className="font-mono text-[13px] text-ink">npm run db:restore -- latest</code> restores the newest one. The server log has the details of this error.
      </p>
    </div>
  );
}
