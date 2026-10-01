"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { LeadStatus } from "@/lib/seo/leads";
import { deleteLeadsAction, resendLeadConfirmationsAction } from "@/lib/actions/leads";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink, IconButton } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Icon, Spinner } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";

export interface LeadRowView {
  id: string;
  email: string;
  name: string;
  status: LeadStatus;
  sourceLabel: string;
  source: string;
  courseTitle: string;
  /** Server-formatted dates (identical before and after hydration). */
  createdLabel: string;
  confirmedLabel: string;
}

const STATUS: Record<LeadStatus, { label: string; tone: "success" | "warning" | "neutral" }> = {
  confirmed: { label: "Confirmed", tone: "success" },
  pending: { label: "Awaiting confirmation", tone: "warning" },
  unsubscribed: { label: "Unsubscribed", tone: "neutral" },
};

/**
 * Lead list of /admin/leads: selection with bulk "resend confirmation" and
 * delete (with confirmation), per-row delete. Filtering, paging and the CSV
 * export happen on the server.
 */
export function LeadsTable({ rows, total, filtered, clearHref }: { rows: LeadRowView[]; total: number; filtered: boolean; clearHref: string }) {
  const toast = useToast();
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmIds, setConfirmIds] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<"delete" | "resend" | null>(null);
  const [pending, startTransition] = useTransition();

  const visibleIds = rows.map((r) => r.id);
  const chosen = visibleIds.filter((id) => selected.has(id));
  const allChosen = rows.length > 0 && chosen.length === rows.length;
  const chosenPending = rows.filter((r) => selected.has(r.id) && r.status === "pending").map((r) => r.id);

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const remove = () => {
    if (!confirmIds) return;
    setBusy("delete");
    startTransition(async () => {
      const result = await deleteLeadsAction(confirmIds);
      setBusy(null);
      if (result.ok) {
        toast.success(result.message ?? "Deleted");
        setSelected(new Set());
        setConfirmIds(null);
        router.refresh();
      } else toast.error(result.error);
    });
  };

  const resend = () => {
    setBusy("resend");
    startTransition(async () => {
      const result = await resendLeadConfirmationsAction(chosenPending);
      setBusy(null);
      if (result.ok) {
        toast.success(result.message ?? "Sent");
        setSelected(new Set());
      } else toast.error(result.error);
    });
  };

  if (!rows.length) {
    return filtered ? (
      <EmptyState
        compact
        icon={<Icon.Search />}
        title="No leads match"
        description="Try another search or clear the filters."
        action={
          <ButtonLink href={clearHref} variant="outline" size="sm">
            Show all leads
          </ButtonLink>
        }
      />
    ) : (
      <EmptyState
        icon={<Icon.Inbox />}
        title="No leads yet"
        description="Sign-ups from the lead forms (blog posts, course pages, the footer and the free resources page) appear here once visitors subscribe."
        action={
          <ButtonLink href="/free" variant="outline" leftIcon={<Icon.Eye className="size-4" />}>
            View the free resources page
          </ButtonLink>
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-2" aria-live="polite">
        <p className="text-xs text-ink-muted">{chosen.length > 0 ? `${chosen.length} selected` : `${rows.length} shown · ${total} in total`}</p>
        {chosen.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={pending || !chosenPending.length} onClick={resend} leftIcon={busy === "resend" ? <Spinner className="size-3.5" /> : <Icon.Send className="size-3.5" />}>
              Resend confirmation{chosenPending.length ? ` (${chosenPending.length})` : ""}
            </Button>
            <Button size="sm" variant="danger" disabled={pending} onClick={() => setConfirmIds(chosen)} leftIcon={<Icon.Trash className="size-3.5" />}>
              Delete
            </Button>
          </div>
        )}
      </div>

      <Table>
        <THead>
          <tr>
            <TH className="w-10">
              <input
                type="checkbox"
                className="size-4 cursor-pointer rounded border-border-strong accent-accent"
                aria-label="Select every lead on this page"
                checked={allChosen}
                onChange={(e) => setSelected(e.target.checked ? new Set(visibleIds) : new Set())}
              />
            </TH>
            <TH>Lead</TH>
            <TH className="hidden sm:table-cell">Status</TH>
            <TH className="hidden md:table-cell">Source</TH>
            <TH className="hidden lg:table-cell">Signed up</TH>
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
                    aria-label={`Select ${row.email}`}
                    checked={selected.has(row.id)}
                    onChange={(e) => toggle(row.id, e.target.checked)}
                  />
                </TD>
                <TD className="max-w-0">
                  <p className="truncate font-medium text-ink">{row.email}</p>
                  <p className="mt-0.5 truncate text-xs text-ink-muted">
                    {row.name || "No name"}
                    {row.courseTitle && <span className="hidden sm:inline"> · {row.courseTitle}</span>}
                  </p>
                  <p className="mt-1 flex flex-wrap gap-1 sm:hidden">
                    <Badge tone={status.tone} size="xs">
                      {status.label}
                    </Badge>
                    <span className="text-xs text-ink-muted">{row.createdLabel}</span>
                  </p>
                </TD>
                <TD className="hidden sm:table-cell">
                  <Badge tone={status.tone} size="xs" dot>
                    {status.label}
                  </Badge>
                  {row.confirmedLabel && <p className="mt-1 whitespace-nowrap text-xs text-ink-muted">Confirmed {row.confirmedLabel}</p>}
                </TD>
                <TD className="hidden md:table-cell">
                  <p className="text-sm text-ink">{row.sourceLabel}</p>
                  <p className="truncate font-mono text-[11px] text-ink-faint">{row.source}</p>
                </TD>
                <TD className="hidden whitespace-nowrap text-xs text-ink-muted lg:table-cell">{row.createdLabel}</TD>
                <TD className="text-right">
                  <IconButton label={`Delete ${row.email}`} size="icon-sm" disabled={pending} onClick={() => setConfirmIds([row.id])}>
                    <Icon.Trash className="size-4 text-danger" />
                  </IconButton>
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>

      <ConfirmDialog
        open={!!confirmIds}
        onClose={() => (pending ? undefined : setConfirmIds(null))}
        onConfirm={remove}
        loading={busy === "delete"}
        destructive
        title={confirmIds && confirmIds.length > 1 ? `Delete ${confirmIds.length} leads?` : "Delete this lead?"}
        description="Their email address and sign-up details are erased for good, and any email sequence they are in stops. Use this for data-erasure requests."
        confirmLabel="Delete"
      />
    </div>
  );
}
