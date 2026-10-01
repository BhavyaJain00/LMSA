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
import { cn, formatBytes, formatNumber, pluralize } from "@/lib/utils";
import { BackupRestoreDialog, useRestoreDialog } from "./backup-restore-dialog";
import { BackupUpload } from "./backup-upload";
import {
  BACKUP_KIND_FILTERS,
  BACKUP_KIND_HINTS,
  BACKUP_KIND_LABELS,
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
  return (
    <Badge tone={KIND_TONES[kind]} size="xs" title={BACKUP_KIND_HINTS[kind]}>
      {BACKUP_KIND_LABELS[kind]}
    </Badge>
  );
}

/** The note under a backup's name: why it exists and who made it. */
function backupNote(row: BackupRow): string {
  const parts = [row.originalName ? `Uploaded as ${row.originalName}` : row.reason, row.createdBy ? `by ${row.createdBy}` : undefined];
  return parts.filter(Boolean).join(" · ");
}

interface RowActionsProps {
  row: BackupRow;
  onRestore: (row: BackupRow) => void;
  onDetails: (row: BackupRow) => void;
  onDelete: (row: BackupRow) => void;
}

function RowActions({ row, onRestore, onDetails, onDelete }: RowActionsProps) {
  return (
    <div className="flex items-center justify-end gap-1">
      <Button variant="outline" size="xs" onClick={() => onRestore(row)}>
        Restore
      </Button>
      <a href={downloadUrl(row.name)} download={row.name} className={buttonClasses({ variant: "ghost", size: "icon-sm" })} aria-label={`Download ${row.name}`} title="Download">
        <Icon.Download className="size-4" />
      </a>
      <Dropdown
        trigger={
          <span className={buttonClasses({ variant: "ghost", size: "icon-sm" })}>
            <Icon.MoreHorizontal className="size-4" />
            <span className="sr-only">More actions for {row.name}</span>
          </span>
        }
        items={[
          { label: "What is in it", icon: <Icon.ListChecks />, onClick: () => onDetails(row) },
          { label: "Delete", icon: <Icon.Trash />, destructive: true, separator: true, onClick: () => onDelete(row) },
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
export function BackupsManager({ backups, storageFormat, maxUploadBytes }: { backups: BackupRow[]; storageFormat: "sqlite" | "json"; maxUploadBytes: number }) {
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
      toast.success("Backup uploaded", "Review what it contains, then confirm the restore.");
      router.refresh();
      openRestore(backup);
    },
    [openRestore, router, toast],
  );

  const rowActions = { onRestore: openRestore, onDetails: setDetails, onDelete: (row: BackupRow) => setDeleting([row.name]) };
  const filtered = kind !== "all" || query.trim() !== "";

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Button leftIcon={<Icon.Plus className="size-4" />} onClick={() => setCreateOpen(true)}>
          Create backup now
        </Button>
        <Dropdown
          align="start"
          className="max-sm:block"
          trigger={
            <span className={buttonClasses({ variant: "outline", className: "max-sm:w-full" })}>
              <Icon.Download className="size-4" />
              Download current data
              <Icon.ChevronDown className="size-4 text-ink-muted" />
            </span>
          }
          items={[
            {
              label: "SQLite file (.sqlite)",
              description: "A compact copy of the whole database.",
              icon: <Icon.Database />,
              onClick: () => startDownload("/api/admin/backup?format=sqlite"),
            },
            {
              label: "JSON export (.json)",
              description: "Readable text; works with any storage setting.",
              icon: <Icon.FileText />,
              onClick: () => startDownload("/api/admin/backup?format=json"),
            },
          ]}
        />
      </div>

      <BackupUpload maxBytes={maxUploadBytes} onUploaded={onUploaded} />

      {backups.length === 0 ? (
        <EmptyState
          compact
          icon={<Icon.Archive />}
          title="No backups yet"
          description="The server makes one automatically every day. You can also create one now."
          action={
            <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
              Create backup now
            </Button>
          }
        />
      ) : (
        <>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" role="group" aria-label="Filter backups by kind">
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
                  {option === "all" ? "All" : BACKUP_KIND_LABELS[option]}
                  <span className="tabular-nums text-xs opacity-80">{kindCounts[option]}</span>
                </button>
              ))}
            </div>
            <div className="lg:w-64">
              <label htmlFor="backup-search" className="sr-only">
                Search backups
              </label>
              <Input
                id="backup-search"
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
                placeholder="Search by name or note"
                leftAddon={<Icon.Search className="size-4" />}
              />
            </div>
          </div>

          {selectedNames.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm" role="status">
              <span className="font-medium text-ink">
                {pluralize(selectedNames.length, "backup")} selected
              </span>
              <span className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
                <Button variant="danger" size="sm" leftIcon={<Icon.Trash className="size-4" />} onClick={() => setDeleting(selectedNames)}>
                  Delete selected
                </Button>
              </span>
            </div>
          )}

          {view.items.length === 0 ? (
            <EmptyState
              compact
              icon={<Icon.Search />}
              title="No backups match"
              description="Try another kind or a different search."
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
                  Show all backups
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
                        aria-label={`Select ${row.name}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="break-all font-mono text-[13px] font-medium text-ink">{row.name}</p>
                        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
                          <KindBadge kind={row.kind} />
                          <span title={row.createdLabel}>{row.ageLabel}</span>
                          <span>{formatBytes(row.sizeBytes)}</span>
                          {row.records !== null && (
                            <span>
                              {pluralize(row.records, "record")}
                            </span>
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
                  <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-ink-muted">
                    <tr>
                      <th scope="col" className="w-10 px-3 py-2.5">
                        <input
                          type="checkbox"
                          className="size-4 cursor-pointer rounded border-border-strong align-middle accent-accent"
                          checked={pageSelected}
                          onChange={(e) => togglePage(e.target.checked)}
                          aria-label="Select every backup on this page"
                        />
                      </th>
                      <th scope="col" className="px-3 py-2.5 font-medium">
                        Backup
                      </th>
                      <th scope="col" className="px-3 py-2.5 font-medium">
                        Created
                      </th>
                      <th scope="col" className="px-3 py-2.5 text-right font-medium">
                        Size
                      </th>
                      <th scope="col" className="px-3 py-2.5 text-right font-medium">
                        Records
                      </th>
                      <th scope="col" className="px-3 py-2.5 text-right font-medium">
                        <span className="sr-only">Actions</span>
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
                            aria-label={`Select ${row.name}`}
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
                        <td className="whitespace-nowrap px-3 py-3 text-right align-top tabular-nums text-ink">{formatBytes(row.sizeBytes)}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-right align-top tabular-nums text-ink">{row.records === null ? "—" : formatNumber(row.records)}</td>
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
                  Showing {view.from}–{view.to} of {pluralize(matching.length, "backup")}
                  {filtered && ` (${backups.length} in total)`}
                </p>
                {view.pages > 1 && (
                  <nav className="flex items-center gap-2" aria-label="Backup pages">
                    <Button variant="outline" size="sm" leftIcon={<Icon.ChevronLeft className="size-4" />} disabled={view.page <= 1} onClick={() => setPage(view.page - 1)}>
                      Previous
                    </Button>
                    <span className="tabular-nums">
                      Page {view.page} of {view.pages}
                    </span>
                    <Button variant="outline" size="sm" rightIcon={<Icon.ChevronRight className="size-4" />} disabled={view.page >= view.pages} onClick={() => setPage(view.page + 1)}>
                      Next
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
        title="Create a backup"
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={create.pending}>
              Cancel
            </Button>
            <Button type="submit" form="create-backup-form" loading={create.pending}>
              Create backup
            </Button>
          </>
        }
      >
        <form id="create-backup-form" onSubmit={create.onSubmit} noValidate className="space-y-3">
          <p className="text-sm text-ink-muted">
            Saves a complete copy of the database ({storageFormat === "sqlite" ? "a SQLite file" : "a JSON file"}) on the server. The site keeps working while it is made. Manual backups are kept
            until you delete them.
          </p>
          <Field label="Note (optional)" htmlFor="backup-note" hint="Shown in the list, for example “Before importing members”.">
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
        title={deleting && deleting.length > 1 ? `Delete ${deleting.length} backups?` : "Delete this backup?"}
        confirmLabel="Delete"
        description={
          deleting && deleting.length === 1 ? (
            <>
              <span className="break-all font-mono text-[13px] text-ink">{deleting[0]}</span> is removed from the server for good. Download it first if you may need it later.
            </>
          ) : (
            "The selected backups are removed from the server for good. Download the ones you may need later first."
          )
        }
      />

      {/* Details */}
      <Dialog
        open={details !== null}
        onClose={() => setDetails(null)}
        size="md"
        title="What is in this backup"
        description={details ? <span className="break-all font-mono text-[13px]">{details.name}</span> : undefined}
        footer={
          details && (
            <>
              <a href={downloadUrl(details.name)} download={details.name} className={buttonClasses({ variant: "outline" })}>
                <Icon.Download className="size-4" />
                Download
              </a>
              <Button
                onClick={() => {
                  setDetails(null);
                  openRestore(details);
                }}
              >
                Restore…
              </Button>
            </>
          )
        }
      >
        {details && (
          <div className="space-y-4 text-sm">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <div>
                <dt className="text-xs text-ink-muted">Kind</dt>
                <dd className="mt-0.5">
                  <KindBadge kind={details.kind} />
                  <span className="mt-1 block text-xs text-ink-muted">{BACKUP_KIND_HINTS[details.kind]}</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink-muted">Created</dt>
                <dd className="mt-0.5 text-ink">{details.createdLabel}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-muted">File</dt>
                <dd className="mt-0.5 text-ink">
                  {details.format === "sqlite" ? "SQLite" : "JSON"}, {formatBytes(details.sizeBytes)}
                  {details.schemaVersion !== null && details.schemaVersion > 0 && <span className="text-ink-muted"> · schema {details.schemaVersion}</span>}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink-muted">Records</dt>
                <dd className="mt-0.5 tabular-nums text-ink">{details.records === null ? "Unknown" : formatNumber(details.records)}</dd>
              </div>
              {backupNote(details) && (
                <div className="col-span-2">
                  <dt className="text-xs text-ink-muted">Note</dt>
                  <dd className="mt-0.5 break-words text-ink">{backupNote(details)}</dd>
                </div>
              )}
            </dl>
            {details.counts === null ? (
              <p className="rounded-lg border border-border bg-surface-2/60 px-3 py-2 text-ink-muted">
                This file was copied into the backups folder by hand, so its contents have not been counted. Choose Restore to check it and see what it holds.
              </p>
            ) : sortedCounts(details.counts).length === 0 ? (
              <p className="text-ink-muted">The backup holds no records.</p>
            ) : (
              <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                {sortedCounts(details.counts).map((entry) => (
                  <div key={entry.name} className="flex items-center justify-between gap-3 border-b border-border py-1.5">
                    <dt className="min-w-0 truncate text-ink-muted">{entry.label}</dt>
                    <dd className="font-medium tabular-nums text-ink">{formatNumber(entry.count)}</dd>
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
