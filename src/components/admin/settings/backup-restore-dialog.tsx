"use client";

import { useCallback, useRef, useState } from "react";
import type { RestorePreview } from "@/lib/db/backup";
import { previewRestoreAction, restoreBackupAction } from "@/app/(app)/admin/settings/data/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { Field, FormError, Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes } from "@/lib/utils";
import { useFormatter, useT } from "@/i18n/client";
import { countChanges, signedNumber } from "./data-labels";
import { useCollectionLabel } from "./use-data-labels";
import { useFormAction } from "./use-form-action";

export type RestoreTarget =
  | { name: string; label: string; status: "loading" }
  | { name: string; label: string; status: "ready"; preview: RestorePreview }
  | { name: string; label: string; status: "error"; error: string };

/**
 * State of the restore dialog. `open(name)` shows the dialog at once and
 * loads what the restore would change; a slower answer for a backup the
 * administrator has already moved on from is dropped.
 */
export function useRestoreDialog() {
  const t = useT("admin");
  const [target, setTarget] = useState<RestoreTarget | null>(null);
  const request = useRef(0);

  const open = useCallback((name: string, label: string = name) => {
    const id = ++request.current;
    setTarget({ name, label, status: "loading" });
    previewRestoreAction(name).then(
      (result) => {
        if (request.current !== id) return;
        setTarget(result.ok ? { name, label, status: "ready", preview: result.data } : { name, label, status: "error", error: result.error });
      },
      () => {
        if (request.current !== id) return;
        setTarget({ name, label, status: "error", error: t("backups.restore.readFailed") });
      },
    );
  }, [t]);

  const close = useCallback(() => {
    request.current++;
    setTarget(null);
  }, []);

  return { target, open, close };
}

const CONFIRM_WORD = "RESTORE";
const FORM_ID = "restore-backup-form";
/** Collections listed before "and N more". */
const MAX_CHANGES = 12;

function PreviewBody({ preview }: { preview: RestorePreview }) {
  const t = useT("admin");
  const f = useFormatter();
  const collectionLabel = useCollectionLabel();
  const { backup } = preview;
  const changes = countChanges(preview.currentCounts, preview.backupCounts);
  const shown = changes.slice(0, MAX_CHANGES);
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-border bg-surface-2/60 p-3 text-sm">
        <div className="col-span-2 min-w-0">
          <dt className="text-xs text-ink-muted">{t("backups.restore.backup")}</dt>
          <dd className="flex flex-wrap items-center gap-2">
            <span className="break-all font-mono text-[13px] text-ink">{backup.name}</span>
            <Badge size="xs">{t(`backups.kinds.${backup.kind}`)}</Badge>
          </dd>
          {backup.originalName && <dd className="mt-0.5 break-all text-xs text-ink-muted">{t("backups.uploadedAs", { name: backup.originalName })}</dd>}
        </div>
        <div>
          <dt className="text-xs text-ink-muted">{t("backups.restore.recordsInBackup")}</dt>
          <dd className="font-medium tabular-nums text-ink">{f.count(preview.backupRecords)}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">{t("backups.restore.recordsNow")}</dt>
          <dd className="font-medium tabular-nums text-ink">{f.count(preview.currentRecords)}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">{t("backups.file")}</dt>
          <dd className="text-ink">
            JSON, {formatBytes(backup.sizeBytes)}
          </dd>
        </div>
      </dl>

      {preview.errors.length > 0 && (
        <div role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger">
          <p className="font-medium">{t("backups.restore.blocked")}</p>
          <ul className="mt-1 list-disc space-y-0.5 ps-5">
            {preview.errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      {preview.warnings.length > 0 && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-ink">
          <p className="flex items-center gap-2 font-medium">
            <Icon.AlertTriangle className="size-4 shrink-0 text-warning" />
            {t("backups.restore.warningsTitle")}
          </p>
          <ul className="mt-1 list-disc space-y-0.5 ps-5 text-ink-muted">
            {preview.warnings.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold text-ink">{t("backups.restore.changesTitle")}</h3>
        {changes.length === 0 ? (
          <p className="mt-1 text-sm text-ink-muted">{t("backups.restore.noChanges")}</p>
        ) : (
          <div className="mt-2 overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-start text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th scope="col" className="px-3 py-2 text-start font-medium">
                    {t("backups.restore.collection")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-end font-medium">
                    {t("backups.restore.now")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-end font-medium">
                    {t("backups.restore.after")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-end font-medium">
                    {t("backups.restore.change")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shown.map((change) => (
                  <tr key={change.name}>
                    <th scope="row" className="px-3 py-1.5 text-start font-normal text-ink">
                      {collectionLabel(change.name, change.label)}
                    </th>
                    <td className="px-3 py-1.5 text-end tabular-nums text-ink-muted">{f.count(change.current)}</td>
                    <td className="px-3 py-1.5 text-end tabular-nums text-ink">{f.count(change.backup)}</td>
                    <td dir="ltr" className={`px-3 py-1.5 text-end font-medium tabular-nums ${change.difference < 0 ? "text-danger" : "text-success"}`}>{signedNumber(change.difference)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {changes.length > shown.length && (
              <p className="border-t border-border px-3 py-2 text-xs text-ink-muted">
                {t("backups.restore.moreCollections", { count: changes.length - shown.length })}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * "Restore this backup": shows what would change, then asks for a typed
 * confirmation. On success the server redirects (back to this page, or to
 * the login page when the administrator's account is not in the backup).
 *
 * Render it with `key={target?.name}` so the typed confirmation and the
 * last error never carry over from one backup to another.
 */
export function BackupRestoreDialog({ target, onClose, onRetry }: { target: RestoreTarget | null; onClose: () => void; onRetry: (name: string, label: string) => void }) {
  const t = useT("admin");
  const tc = useT("common");
  const [confirm, setConfirm] = useState("");
  const { onSubmit, pending, errors, formError } = useFormAction(restoreBackupAction, { toastSuccess: false, toastError: false });
  const blocked = target?.status !== "ready" || target.preview.errors.length > 0;

  return (
    <Dialog
      open={target !== null}
      // A restore that has started cannot be abandoned by closing the dialog.
      onClose={() => (pending ? undefined : onClose())}
      size="md"
      title={t("backups.restore.title")}
      description={target && target.label !== target.name ? target.label : undefined}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {blocked && target?.status !== "loading" ? tc("actions.close") : tc("actions.cancel")}
          </Button>
          <Button type="submit" form={FORM_ID} variant="danger" loading={pending} disabled={blocked || confirm !== CONFIRM_WORD}>
            {t("backups.restore.submit")}
          </Button>
        </>
      }
    >
      {target && (
        <form id={FORM_ID} onSubmit={onSubmit} noValidate className="space-y-4">
          <input type="hidden" name="name" value={target.name} />

          {target.status === "loading" && (
            <div aria-busy="true" aria-live="polite" className="space-y-3">
              <span className="sr-only">{t("backups.restore.reading")}</span>
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-28 w-full" />
            </div>
          )}

          {target.status === "error" && (
            <div className="space-y-3">
              <FormError message={target.error} />
              <Button variant="outline" size="sm" leftIcon={<Icon.Refresh className="size-4" />} onClick={() => onRetry(target.name, target.label)}>
                {tc("actions.tryAgain")}
              </Button>
            </div>
          )}

          {target.status === "ready" && <PreviewBody preview={target.preview} />}

          {!blocked && (
            <>
              <p className="text-sm text-ink-muted">{t("backups.restore.explain")}</p>
              <Field
                label={t.rich("backups.restore.typeToConfirm", {
                  word: CONFIRM_WORD,
                  mono: (chunks) => (
                    <span dir="ltr" className="font-mono">
                      {chunks}
                    </span>
                  ),
                })}
                htmlFor="restore-confirm"
                error={errors.confirm}
              >
                <Input
                  id="restore-confirm"
                  name="confirm"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  className="font-mono"
                  invalid={!!errors.confirm}
                  readOnly={pending}
                />
              </Field>
            </>
          )}

          {formError && !errors.confirm && <FormError message={formError} />}
        </form>
      )}
    </Dialog>
  );
}
