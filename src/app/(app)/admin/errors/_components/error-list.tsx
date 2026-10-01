"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { deleteErrorsAction, setErrorsResolvedAction } from "@/lib/errors/actions";
import { RowCheckbox, SelectAllCheckbox, useSelection } from "@/components/assessments/bulk-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export interface ErrorRow {
  id: string;
  message: string;
  path?: string;
  source: string;
  browser: boolean;
  count: string;
  resolved: boolean;
  /** Pre-formatted on the server so the whole page uses one clock. */
  lastSeen: { iso: string; relative: string; full: string };
  firstSeenRelative: string;
}

/**
 * Grouped error list with row selection. Selected groups can be resolved,
 * reopened or deleted together; each row opens the group's detail page.
 */
export function ErrorList({ rows }: { rows: ErrorRow[] }) {
  const selection = useSelection(rows.map((r) => r.id));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const selectedRows = rows.filter((r) => selection.isSelected(r.id));
  const anyOpen = selectedRows.some((r) => !r.resolved);
  const anyResolved = selectedRows.some((r) => r.resolved);

  function run(task: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>, after?: () => void) {
    startTransition(async () => {
      const res = await task();
      if (res.ok) {
        toast({ title: res.message ?? "Done", tone: "success" });
        selection.clear();
        after?.();
      } else {
        toast({ title: res.error, tone: "error" });
      }
    });
  }

  return (
    <div>
      {selection.selected.length > 0 && (
        <div role="region" aria-label="Selection actions" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-accent/30 bg-accent/5 px-3 py-2 animate-fade-in">
          <p className="text-sm font-medium text-ink" aria-live="polite">
            {selection.selected.length} {selection.selected.length === 1 ? "error" : "errors"} selected
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={selection.clear} disabled={pending}>
              Clear
            </Button>
            {anyOpen && (
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<Icon.CheckCircle className="size-4" />}
                disabled={pending}
                onClick={() => run(() => setErrorsResolvedAction(selection.selected, true))}
              >
                Resolve
              </Button>
            )}
            {anyResolved && (
              <Button variant="ghost" size="sm" leftIcon={<Icon.Refresh className="size-4" />} disabled={pending} onClick={() => run(() => setErrorsResolvedAction(selection.selected, false))}>
                Reopen
              </Button>
            )}
            <Button variant="ghost" size="sm" className="text-danger hover:bg-danger/10" leftIcon={<Icon.Trash className="size-4" />} disabled={pending} onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          </div>
        </div>
      )}

      <Table>
        <THead>
          <tr>
            <TH className="w-10 pr-0">
              <SelectAllCheckbox checked={selection.allSelected} indeterminate={selection.someSelected} onChange={selection.toggleAll} label="Select every error on this page" />
            </TH>
            <TH>Error</TH>
            <TH className="hidden md:table-cell">Source</TH>
            <TH className="text-right">Count</TH>
            <TH className="hidden sm:table-cell">Last seen</TH>
          </tr>
        </THead>
        <TBody>
          {rows.map((r) => {
            const selected = selection.isSelected(r.id);
            return (
              <TR key={r.id} className={cn("relative transition-colors hover:bg-surface-2", selected && "bg-accent/5")}>
                <TD className="relative z-10 w-10 pr-0 align-top">
                  <RowCheckbox checked={selected} onChange={() => selection.toggle(r.id)} label={`Select “${r.message.slice(0, 60)}”`} />
                </TD>
                <TD className="max-w-0 w-full align-top">
                  <Link
                    href={`/admin/errors/${r.id}`}
                    className="block font-medium text-ink after:absolute after:inset-0 hover:underline focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-accent/40"
                  >
                    <span className="line-clamp-2 break-words">{r.message}</span>
                  </Link>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
                    {r.path && <span className="max-w-full truncate font-mono">{r.path}</span>}
                    {r.resolved && (
                      <Badge tone="success" size="xs" dot>
                        Resolved
                      </Badge>
                    )}
                    <span className="md:hidden">{r.source}</span>
                    <time dateTime={r.lastSeen.iso} title={r.lastSeen.full} className="sm:hidden">
                      {r.lastSeen.relative}
                    </time>
                  </span>
                </TD>
                <TD className="hidden whitespace-nowrap align-top md:table-cell">
                  <Badge tone={r.browser ? "info" : "neutral"}>{r.source}</Badge>
                </TD>
                <TD className="whitespace-nowrap text-right align-top font-medium tabular-nums">{r.count}</TD>
                <TD className="hidden whitespace-nowrap align-top text-ink-muted sm:table-cell">
                  <time dateTime={r.lastSeen.iso} title={r.lastSeen.full}>
                    {r.lastSeen.relative}
                  </time>
                  <span className="block text-xs text-ink-faint">first {r.firstSeenRelative}</span>
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => (pending ? undefined : setConfirmDelete(false))}
        title={selection.selected.length === 1 ? "Delete this error?" : `Delete ${selection.selected.length} errors?`}
        description="The groups and their stack traces are removed. If the problem happens again it is logged as a new error."
        confirmLabel="Delete"
        destructive
        loading={pending}
        onConfirm={() => run(() => deleteErrorsAction(selection.selected), () => setConfirmDelete(false))}
      />
    </div>
  );
}
