"use client";

import { useState, useTransition } from "react";
import { addRedirectAction, deleteRedirectsAction } from "@/lib/actions/seo-settings";
import type { RedirectTargetStatus } from "@/lib/seo/redirects";
import { useFormAction } from "@/components/admin/settings/use-form-action";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button, ButtonLink, IconButton } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";

export interface RedirectRowView {
  id: string;
  fromPath: string;
  toPath: string;
  status: RedirectTargetStatus;
  /** Formatted on the server so the date reads the same before and after hydration. */
  added: string;
}

const STATUS: Record<RedirectTargetStatus, { label: string; tone: BadgeTone; hint: string }> = {
  live: { label: "Live", tone: "success", hint: "Leads to a published page." },
  hidden: { label: "Not public", tone: "warning", hint: "Leads to a draft or private page: visitors without access see “not found”." },
  missing: { label: "Deleted", tone: "danger", hint: "The destination no longer exists. Point the old address somewhere else or remove the redirect." },
  page: { label: "Page", tone: "neutral", hint: "Leads to another page of the site." },
};

function AddRedirectForm() {
  const [fromPath, setFromPath] = useState("");
  const [toPath, setToPath] = useState("");
  const { onSubmit, pending, errors } = useFormAction(addRedirectAction, {
    onSuccess: () => {
      setFromPath("");
      setToPath("");
    },
  });
  return (
    <form onSubmit={onSubmit} noValidate className="rounded-card border border-border bg-surface-1 p-4 shadow-card">
      <h3 className="text-sm font-semibold text-ink">Add a redirect</h3>
      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] md:items-start">
        <div>
          <label htmlFor="redirect-from" className="mb-1 block text-xs font-medium text-ink-muted">
            Old address
          </label>
          <Input
            id="redirect-from"
            name="fromPath"
            value={fromPath}
            onChange={(e) => setFromPath(e.target.value)}
            placeholder="/courses/old-name"
            className="font-mono"
            autoComplete="off"
            spellCheck={false}
            invalid={!!errors.fromPath}
            aria-describedby={errors.fromPath ? "redirect-from-error" : undefined}
            required
          />
          {errors.fromPath && (
            <p id="redirect-from-error" className="mt-1 text-xs text-danger" role="alert">
              {errors.fromPath}
            </p>
          )}
        </div>
        <Icon.ArrowRight className="hidden size-4 text-ink-faint md:mt-8 md:block rtl:rotate-180" aria-hidden="true" />
        <div>
          <label htmlFor="redirect-to" className="mb-1 block text-xs font-medium text-ink-muted">
            New address
          </label>
          <Input
            id="redirect-to"
            name="toPath"
            value={toPath}
            onChange={(e) => setToPath(e.target.value)}
            placeholder="/courses/new-name"
            className="font-mono"
            autoComplete="off"
            spellCheck={false}
            invalid={!!errors.toPath}
            aria-describedby={errors.toPath ? "redirect-to-error" : undefined}
            required
          />
          {errors.toPath && (
            <p id="redirect-to-error" className="mt-1 text-xs text-danger" role="alert">
              {errors.toPath}
            </p>
          )}
        </div>
        <Button type="submit" loading={pending} disabled={!fromPath.trim() || !toPath.trim()} leftIcon={<Icon.Plus className="size-4" />} className="md:mt-6">
          Add
        </Button>
      </div>
      <p className="mt-2 text-xs text-ink-muted">Paths on this site only. Pages below the old address follow it: lessons of a renamed course keep working too.</p>
    </form>
  );
}

export function RedirectsManager({ origin, rows, total, filtered, clearHref }: { origin: string; rows: RedirectRowView[]; total: number; filtered: boolean; clearHref: string }) {
  const toast = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<string[] | null>(null);
  const [deleting, startDelete] = useTransition();

  // Rows change after a save or a page change: only ids still on screen count as selected.
  const visibleIds = rows.map((r) => r.id);
  const chosen = visibleIds.filter((id) => selected.has(id));
  const allChosen = rows.length > 0 && chosen.length === rows.length;

  const toggle = (id: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const remove = () => {
    const ids = confirm;
    if (!ids?.length) return;
    startDelete(async () => {
      const result = await deleteRedirectsAction(ids);
      if (result.ok) {
        toast.success(result.message ?? "Removed");
        setSelected(new Set());
        setConfirm(null);
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="space-y-4">
      <AddRedirectForm />

      {rows.length === 0 ? (
        filtered ? (
          <EmptyState
            compact
            icon={<Icon.Search />}
            title="No redirects match"
            description="Try another address or clear the filter."
            action={
              <ButtonLink href={clearHref} variant="outline" size="sm">
                Show all redirects
              </ButtonLink>
            }
          />
        ) : (
          <EmptyState
            compact
            icon={<Icon.Link />}
            title="No redirects yet"
            description="Nothing has been renamed so far. When you change the URL of a published page, its old address is listed here and keeps working."
          />
        )
      ) : (
        <>
          <div className="flex min-h-9 flex-wrap items-center justify-between gap-2" aria-live="polite">
            <p className="text-xs text-ink-muted">
              {chosen.length > 0 ? `${chosen.length} selected` : filtered ? `${rows.length} shown on this page · ${total} in total` : `${total} in total`}
            </p>
            {chosen.length > 0 && (
              <Button size="sm" variant="danger" onClick={() => setConfirm(chosen)} leftIcon={<Icon.Trash className="size-3.5" />}>
                Remove selected
              </Button>
            )}
          </div>
          <Table>
            <THead>
              <tr>
                <TH className="w-10">
                  <input
                    type="checkbox"
                    className="size-4 cursor-pointer rounded border-border-strong accent-accent"
                    aria-label="Select every redirect on this page"
                    checked={allChosen}
                    onChange={(e) => setSelected(e.target.checked ? new Set(visibleIds) : new Set())}
                  />
                </TH>
                <TH>Old address</TH>
                <TH className="hidden md:table-cell">New address</TH>
                <TH className="hidden sm:table-cell">Destination</TH>
                <TH className="hidden lg:table-cell">Added</TH>
                <TH className="w-12 text-right">
                  <span className="sr-only">Actions</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((row) => {
                const status = STATUS[row.status];
                return (
                  <TR key={row.id}>
                    <TD>
                      <input
                        type="checkbox"
                        className="size-4 cursor-pointer rounded border-border-strong accent-accent"
                        aria-label={`Select the redirect from ${row.fromPath}`}
                        checked={selected.has(row.id)}
                        onChange={(e) => toggle(row.id, e.target.checked)}
                      />
                    </TD>
                    <TD className="max-w-0">
                      <a href={`${origin}${row.fromPath}`} target="_blank" rel="noopener" className="block truncate font-mono text-xs text-ink hover:underline" title={`Test ${row.fromPath}`}>
                        {row.fromPath}
                      </a>
                      <p className="mt-0.5 flex items-center gap-1 truncate font-mono text-xs text-ink-muted md:hidden">
                        <Icon.ArrowRight className="size-3 shrink-0 rtl:rotate-180" aria-hidden="true" />
                        <span className="sr-only">redirects to</span>
                        <span className="truncate">{row.toPath}</span>
                      </p>
                      <p className="mt-1 sm:hidden">
                        <Badge tone={status.tone} size="xs">
                          {status.label}
                        </Badge>
                      </p>
                    </TD>
                    <TD className="hidden max-w-0 md:table-cell">
                      <a href={`${origin}${row.toPath}`} target="_blank" rel="noopener" className="block truncate font-mono text-xs text-accent hover:underline">
                        {row.toPath}
                      </a>
                    </TD>
                    <TD className="hidden sm:table-cell">
                      <span title={status.hint}>
                        <Badge tone={status.tone} size="xs">
                          {status.label}
                        </Badge>
                      </span>
                    </TD>
                    <TD className="hidden whitespace-nowrap text-xs text-ink-muted lg:table-cell">{row.added}</TD>
                    <TD className="text-right">
                      <IconButton label={`Remove the redirect from ${row.fromPath}`} size="icon-sm" className="hover:text-danger" onClick={() => setConfirm([row.id])}>
                        <Icon.Trash className="size-4" />
                      </IconButton>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </>
      )}

      <ConfirmDialog
        open={!!confirm}
        onClose={() => (deleting ? undefined : setConfirm(null))}
        onConfirm={remove}
        loading={deleting}
        destructive
        title={confirm && confirm.length > 1 ? `Remove ${confirm.length} redirects?` : "Remove this redirect?"}
        description="The old address stops redirecting and shows “not found” to visitors and search engines. Links pointing at it lose their value."
        confirmLabel="Remove"
      />
    </div>
  );
}
