"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { BackupInfo } from "@/lib/db/backup";
import { createBackupAction, deleteBackupsAction } from "@/app/(app)/admin/settings/data/actions";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Dropdown } from "@/components/ui/dropdown";
import { Icon } from "@/components/ui/icons";
import { Field, Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { cn, formatBytes } from "@/lib/utils";
import { useFormatter, useT } from "@/i18n/client";
import { BackupRestoreDialog, useRestoreDialog } from "./backup-restore-dialog";
import { BackupUpload } from "./backup-upload";
import { useCollectionLabel } from "./use-data-labels";
import {
  BACKUP_KIND_FILTERS,
  countByKind,
  filterBackups,
  pageOf,
  sortedCounts,
  type BackupKindFilter,
  type BackupKindName,
  type BackupRow,
} from "./data-labels";
import { useFormAction } from "./use-form-action";

const KIND_TONES: Record<BackupKindName, BadgeTone> = { auto: "info", manual: "accent", safety: "warning", upload: "neutral" };
const MAX_NOTE_LENGTH = 200;

const downloadUrl = (name: string) => `/api/admin/backup/${encodeURIComponent(name)}`;

/** Start a file download from a route handler without leaving the page. */
function startDownload(url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = "";
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
}

function KindBadge({ kind }: { kind: BackupKindName }) {
  const t = useT("admin");
  return (
    <Badge tone={KIND_TONES[kind]} size="xs" title={t(`backups.kindHints.${kind}`)}>
      {t(`backups.kinds.${kind}`)}
    </Badge>
  );
}

/** The note under a backup's name: why it exists and who made it. */
function useBackupNote(): (row: BackupRow) => string {
  const t = useT("admin");
  return (row) => {
    const parts = [row.originalName ? t("backups.uploadedAs", { name: row.originalName }) : row.reason, row.createdBy ? t("backups.by", { name: row.createdBy }) : undefined];
    return parts.filter(Boolean).join(" · ");
  };
}

interface RowActionsProps {
  row: BackupRow;
  onRestore: (row: BackupRow) => void;
  onDetails: (row: BackupRow) => void;
  onDelete: (row: BackupRow) => void;
}

function RowActions({ row, onRestore, onDetails, onDelete }: RowActionsProps) {
  const t = useT("admin");
  const tc = useT("common");
  return (
    <div className="flex items-center justify-end gap-1">
      <Button variant="outline" size="xs" onClick={() => onRestore(row)}>
        {t("backups.actions.restore")}
      </Button>
      <a href={downloadUrl(row.name)} download={row.name} className={buttonClasses({ variant: "ghost", size: "icon-sm" })} aria-label={t("backups.actions.downloadNamed", { name: row.name })} title={tc("actions.download")}>
        <Icon.Download className="size-4" />
      </a>
      <Dropdown
        trigger={
          <span className={buttonClasses({ variant: "ghost", size: "icon-sm" })}>
            <Icon.MoreHorizontal className="size-4" />
            <span className="sr-only">{t("backups.actions.more", { name: row.name })}</span>
          </span>
        }
        items={[
          { label: t("backups.actions.details"), icon: <Icon.ListChecks />, onClick: () => onDetails(row) },
          { label: tc("actions.delete"), icon: <Icon.Trash />, destructive: true, separator: true, onClick: () => onDelete(row) },
        ]}
      />
    </div>
  );
}

/**
 * The backups list on Admin → Settings → Backup & reset: create a backup,
 * download the live data, upload a file to restore, and download, inspect,
 * restore or delete stored backups (filter by kind, search, pages, bulk
 * delete).
 */
export function BackupsManager({ backups, maxUploadBytes }: { backups: BackupRow[]; maxUploadBytes: number }) {
  const t = useT("admin");
  const tc = useT("common");
  const f = useFormatter();
  const collectionLabel = useCollectionLabel();
  const backupNote = useBackupNote();
  const router = useRouter();
  const toast = useToast();
  const [kind, setKind] = useState<BackupKindFilter>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [note, setNote] = useState("");
  const [deleting, setDeleting] = useState<string[] | null>(null);
  const [details, setDetails] = useState<BackupRow | null>(null);
  const { target: restoreTarget, open: openRestoreDialog, close: closeRestoreDialog } = useRestoreDialog();

  const create = useFormAction(createBackupAction, {
    onSuccess: () => {
      setCreateOpen(false);
      setNote("");
      setKind("all");
      setQuery("");
      setPage(1);
    },
  });
  const remove = useFormAction(deleteBackupsAction, {
    onSuccess: () => {
      setDeleting(null);
      setSelected(new Set());
    },
  });

  const kindCounts = countByKind(backups);
  const matching = filterBackups(backups, kind, query);
  const view = pageOf(matching, page);
  // Backups deleted elsewhere (retention, another administrator) drop out of the selection.
  const selectedNames = backups.filter((row) => selected.has(row.name)).map((row) => row.name);
  const pageSelected = view.items.length > 0 && view.items.every((row) => selected.has(row.name));

  const toggle = (name: string, on: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(name);
      else next.delete(name);
      return next;
    });
  };
  const togglePage = (on: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      for (const row of view.items) {
        if (on) next.add(row.name);
        else next.delete(row.name);
      }
      return next;
    });
  };

  const changeKind = (next: BackupKindFilter) => {
    setKind(next);
    setPage(1);
  };

  const confirmDelete = () => {
    if (!deleting?.length) return;
    const formData = new FormData();
    for (const name of deleting) formData.append("name", name);
    remove.submit(formData);
  };

  const openRestore = useCallback((row: Pick<BackupRow, "name" | "originalName">) => openRestoreDialog(row.name, row.originalName ?? row.name), [openRestoreDialog]);

  const onUploaded = useCallback(
    (backup: BackupInfo) => {
      toast.success(t("backups.uploaded.title"), t("backups.uploaded.description"));
      router.refresh();
      openRestore(backup);
    },
    [openRestore, router, toast, t],
  );

  const rowActions = { onRestore: openRestore, onDetails: setDetails, onDelete: (row: BackupRow) => setDeleting([row.name]) };
  const filtered = kind !== "all" || query.trim() !== "";

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Button leftIcon={<Icon.Plus className="size-4" />} onClick={() => setCreateOpen(true)}>
          {t("backups.createNow")}
        </Button>
        <Button variant="outline" className="max-sm:w-full" leftIcon={<Icon.Download className="size-4" />} onClick={() => startDownload("/api/admin/backup")}>
          {t("backups.downloadCurrent")}
        </Button>
      </div>

      <BackupUpload maxBytes={maxUploadBytes} onUploaded={onUploaded} />

      {backups.length === 0 ? (
        <EmptyState
          compact
          icon={<Icon.Archive />}
          title={t("backups.empty.title")}
          description={t("backups.empty.description")}
          action={
            <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
              {t("backups.createNow")}
            </Button>
          }
        />
      ) : (
        <>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" role="group" aria-label={t("backups.filter.label")}>
              {BACKUP_KIND_FILTERS.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={kind === option}
                  onClick={() => changeKind(option)}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors",
                    kind === option ? "border-accent bg-accent/10 font-medium text-accent" : "border-border text-ink-muted hover:bg-surface-2 hover:text-ink",
                  )}
                >
                  {option === "all" ? t("backups.filter.all") : t(`backups.kinds.${option}`)}
                  <span className="tabular-nums text-xs opacity-80">{kindCounts[option]}</span>
                </button>
              ))}
            </div>
            <div className="lg:w-64">
              <label htmlFor="backup-search" className="sr-only">
                {t("backups.search.label")}
              </label>
              <Input
                id="backup-search"
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
                placeholder={t("backups.search.placeholder")}
                leftAddon={<Icon.Search className="size-4" />}
              />
            </div>
          </div>

          {selectedNames.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm" role="status">
              <span className="font-medium text-ink">{t("backups.selected", { count: selectedNames.length })}</span>
              <span className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                  {tc("actions.clear")}
                </Button>
                <Button variant="danger" size="sm" leftIcon={<Icon.Trash className="size-4" />} onClick={() => setDeleting(selectedNames)}>
                  {t("backups.deleteSelected")}
                </Button>
              </span>
            </div>
          )}

          {view.items.length === 0 ? (
            <EmptyState
              compact
              icon={<Icon.Search />}
              title={t("backups.noMatch.title")}
              description={t("backups.noMatch.description")}
              action={
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setKind("all");
                    setQuery("");
                    setPage(1);
                  }}
                >
                  {t("backups.noMatch.showAll")}
                </Button>
              }
            />
          ) : (
            <>
              {/* Phones: one card per backup. */}
              <ul className="space-y-3 md:hidden">
                {view.items.map((row) => (
                  <li key={row.name} className="rounded-lg border border-border bg-surface-1 p-3">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-1 size-4 shrink-0 cursor-pointer rounded border-border-strong accent-accent"
                        checked={selected.has(row.name)}
                        onChange={(e) => toggle(row.name, e.target.checked)}
                        aria-label={t("backups.select", { name: row.name })}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="break-all font-mono text-[13px] font-medium text-ink">{row.name}</p>
                        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
                          <KindBadge kind={row.kind} />
                          <span title={row.createdLabel}>{row.ageLabel}</span>
                          <span>{formatBytes(row.sizeBytes)}</span>
                          {row.records !== null && (
                            <span>{t("backups.records", { count: row.records })}</span>
                          )}
                        </p>
                        {backupNote(row) && <p className="mt-1 break-words text-xs text-ink-muted">{backupNote(row)}</p>}
                      </div>
                    </div>
                    <div className="mt-3 border-t border-border pt-2">
                      <RowActions row={row} {...rowActions} />
                    </div>
                  </li>
                ))}
              </ul>

              {/* Wider screens: a table. */}
              <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
                <table className="w-full text-sm">
                  <thead className="bg-surface-2 text-start text-xs uppercase tracking-wide text-ink-muted">
                    <tr>
                      <th scope="col" className="w-10 px-3 py-2.5">
                        <input
                          type="checkbox"
                          className="size-4 cursor-pointer rounded border-border-strong align-middle accent-accent"
                          checked={pageSelected}
                          onChange={(e) => togglePage(e.target.checked)}
                          aria-label={t("backups.selectPage")}
                        />
                      </th>
                      <th scope="col" className="px-3 py-2.5 text-start font-medium">
                        {t("backups.columns.backup")}
                      </th>
                      <th scope="col" className="px-3 py-2.5 text-start font-medium">
                        {t("backups.columns.created")}
                      </th>
                      <th scope="col" className="px-3 py-2.5 text-end font-medium">
                        {t("backups.columns.size")}
                      </th>
                      <th scope="col" className="px-3 py-2.5 text-end font-medium">
                        {t("backups.columns.records")}
                      </th>
                      <th scope="col" className="px-3 py-2.5 text-end font-medium">
                        <span className="sr-only">{t("backups.columns.actions")}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {view.items.map((row) => (
                      <tr key={row.name} className={cn(selected.has(row.name) && "bg-accent/5")}>
                        <td className="px-3 py-3 align-top">
                          <input
                            type="checkbox"
                            className="size-4 cursor-pointer rounded border-border-strong accent-accent"
                            checked={selected.has(row.name)}
                            onChange={(e) => toggle(row.name, e.target.checked)}
                            aria-label={t("backups.select", { name: row.name })}
                          />
                        </td>
                        <td className="max-w-xs px-3 py-3 align-top">
                          <p className="flex flex-wrap items-center gap-2">
                            <span className="break-all font-mono text-[13px] font-medium text-ink">{row.name}</span>
                            <KindBadge kind={row.kind} />
                          </p>
                          {backupNote(row) && <p className="mt-0.5 break-words text-xs text-ink-muted">{backupNote(row)}</p>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 align-top">
                          <p className="text-ink">{row.ageLabel}</p>
                          <p className="text-xs text-ink-muted">{row.createdLabel}</p>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-end align-top tabular-nums text-ink">{formatBytes(row.sizeBytes)}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-end align-top tabular-nums text-ink">{row.records === null ? "—" : f.count(row.records)}</td>
                        <td className="px-3 py-2.5 align-top">
                          <RowActions row={row} {...rowActions} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col gap-2 text-sm text-ink-muted sm:flex-row sm:items-center sm:justify-between">
                <p aria-live="polite">
                  {filtered
                    ? t("backups.showingFiltered", { from: view.from, to: view.to, count: matching.length, total: backups.length })
                    : t("backups.showing", { from: view.from, to: view.to, count: matching.length })}
                </p>
                {view.pages > 1 && (
                  <nav className="flex items-center gap-2" aria-label={t("backups.pages")}>
                    <Button variant="outline" size="sm" leftIcon={<Icon.ChevronLeft className="size-4 rtl:rotate-180" />} disabled={view.page <= 1} onClick={() => setPage(view.page - 1)}>
                      {tc("actions.previous")}
                    </Button>
                    <span className="tabular-nums">{t("backups.pageOf", { page: view.page, pages: view.pages })}</span>
                    <Button variant="outline" size="sm" rightIcon={<Icon.ChevronRight className="size-4 rtl:rotate-180" />} disabled={view.page >= view.pages} onClick={() => setPage(view.page + 1)}>
                      {tc("actions.next")}
                    </Button>
                  </nav>
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* Create */}
      <Dialog
        open={createOpen}
        onClose={() => (create.pending ? undefined : setCreateOpen(false))}
        size="sm"
        title={t("backups.create.title")}
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={create.pending}>
              {tc("actions.cancel")}
            </Button>
            <Button type="submit" form="create-backup-form" loading={create.pending}>
              {t("backups.create.submit")}
            </Button>
          </>
        }
      >
        <form id="create-backup-form" onSubmit={create.onSubmit} noValidate className="space-y-3">
          <p className="text-sm text-ink-muted">{t("backups.create.description")}</p>
          <Field label={t("backups.create.note")} htmlFor="backup-note" hint={t("backups.create.noteHint")}>
            <Input id="backup-note" name="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={MAX_NOTE_LENGTH} autoComplete="off" />
          </Field>
        </form>
      </Dialog>

      {/* Delete */}
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => (remove.pending ? undefined : setDeleting(null))}
        onConfirm={confirmDelete}
        destructive
        loading={remove.pending}
        title={deleting && deleting.length > 1 ? t("backups.delete.titleMany", { count: deleting.length }) : t("backups.delete.title")}
        confirmLabel={tc("actions.delete")}
        description={
          deleting && deleting.length === 1
            ? t.rich("backups.delete.descriptionOne", {
                name: deleting[0],
                mono: (chunks) => <span className="break-all font-mono text-[13px] text-ink">{chunks}</span>,
              })
            : t("backups.delete.descriptionMany")
        }
      />

      {/* Details */}
      <Dialog
        open={details !== null}
        onClose={() => setDetails(null)}
        size="md"
        title={t("backups.details.title")}
        description={details ? <span className="break-all font-mono text-[13px]">{details.name}</span> : undefined}
        footer={
          details && (
            <>
              <a href={downloadUrl(details.name)} download={details.name} className={buttonClasses({ variant: "outline" })}>
                <Icon.Download className="size-4" />
                {tc("actions.download")}
              </a>
              <Button
                onClick={() => {
                  setDetails(null);
                  openRestore(details);
                }}
              >
                {t("backups.details.restore")}
              </Button>
            </>
          )
        }
      >
        {details && (
          <div className="space-y-4 text-sm">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <div>
                <dt className="text-xs text-ink-muted">{t("backups.details.kind")}</dt>
                <dd className="mt-0.5">
                  <KindBadge kind={details.kind} />
                  <span className="mt-1 block text-xs text-ink-muted">{t(`backups.kindHints.${details.kind}`)}</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink-muted">{t("backups.columns.created")}</dt>
                <dd className="mt-0.5 text-ink">{details.createdLabel}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-muted">{t("backups.file")}</dt>
                <dd className="mt-0.5 text-ink">
                  JSON, {formatBytes(details.sizeBytes)}
                  {details.schemaVersion !== null && details.schemaVersion > 0 && <span className="text-ink-muted"> · {t("backups.details.schema", { version: details.schemaVersion })}</span>}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink-muted">{t("backups.columns.records")}</dt>
                <dd className="mt-0.5 tabular-nums text-ink">{details.records === null ? t("backups.details.unknown") : f.count(details.records)}</dd>
              </div>
              {backupNote(details) && (
                <div className="col-span-2">
                  <dt className="text-xs text-ink-muted">{t("backups.details.note")}</dt>
                  <dd className="mt-0.5 break-words text-ink">{backupNote(details)}</dd>
                </div>
              )}
            </dl>
            {details.counts === null ? (
              <p className="rounded-lg border border-border bg-surface-2/60 px-3 py-2 text-ink-muted">{t("backups.details.notCounted")}</p>
            ) : sortedCounts(details.counts).length === 0 ? (
              <p className="text-ink-muted">{t("backups.details.noRecords")}</p>
            ) : (
              <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                {sortedCounts(details.counts).map((entry) => (
                  <div key={entry.name} className="flex items-center justify-between gap-3 border-b border-border py-1.5">
                    <dt className="min-w-0 truncate text-ink-muted">{collectionLabel(entry.name, entry.label)}</dt>
                    <dd className="font-medium tabular-nums text-ink">{f.count(entry.count)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        )}
      </Dialog>

      <BackupRestoreDialog key={restoreTarget?.name ?? "closed"} target={restoreTarget} onClose={closeRestoreDialog} onRetry={openRestoreDialog} />
    </div>
  );
}
