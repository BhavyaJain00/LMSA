"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { BlogPostStatus } from "@/lib/types";
import { bulkPostAction, deletePostAction, duplicatePostAction } from "@/lib/actions/blog";
import type { BulkPostOperation } from "@/lib/seo/blog";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Dropdown, type DropdownItem } from "@/components/ui/dropdown";
import { Icon, Spinner } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { POST_STATUS } from "./post-status";
import { useT } from "@/i18n/client";

/* Rendered through `./posts-table.tsx`, which provides the `blogAdmin.` messages on the admin page. */

export interface PostRowView {
  id: string;
  title: string;
  slug: string;
  status: BlogPostStatus;
  /** Server-formatted dates (identical before and after hydration). */
  dateLabel: string;
  updatedLabel: string;
  author: string;
  categories: string;
  views: number;
  focusKeyword?: string;
  noindex: boolean;
}

const BULK = [
  { op: "publish", label: "blogAdmin.bulk.publish", icon: "Globe" },
  { op: "draft", label: "blogAdmin.bulk.draft", icon: "EyeOff" },
  { op: "noindex", label: "blogAdmin.bulk.noindex", icon: "Shield" },
  { op: "index", label: "blogAdmin.bulk.index", icon: "Search" },
] as const satisfies readonly { op: BulkPostOperation; label: string; icon: keyof typeof Icon }[];

type Confirm = { kind: "delete"; ids: string[]; title?: string } | null;

/**
 * Article list of /admin/blog: selection with bulk publish / unpublish /
 * noindex / delete, and per-row edit, view, duplicate and delete (with
 * confirmation). Rows are filtered and paginated on the server.
 */
export function PostsTable({ rows, total, filtered, clearHref, showAuthor }: { rows: PostRowView[]; total: number; filtered: boolean; clearHref: string; showAuthor: boolean }) {
  const t = useT("public");
  const common = useT("common");
  const toast = useToast();
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const visibleIds = rows.map((r) => r.id);
  const chosen = visibleIds.filter((id) => selected.has(id));
  const allChosen = rows.length > 0 && chosen.length === rows.length;

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const runBulk = (op: BulkPostOperation, ids: string[]) => {
    setBusy(op);
    startTransition(async () => {
      const result = await bulkPostAction(ids, op);
      setBusy(null);
      if (result.ok) {
        toast.success(result.message ?? common("actions.done"));
        setSelected(new Set());
        setConfirm(null);
        router.refresh();
      } else toast.error(result.error);
    });
  };

  const remove = () => {
    if (!confirm) return;
    if (confirm.ids.length > 1) return runBulk("delete", confirm.ids);
    const [id] = confirm.ids;
    setBusy("delete");
    startTransition(async () => {
      const result = await deletePostAction(id!);
      setBusy(null);
      if (result.ok) {
        toast.success(result.message ?? t("blogAdmin.deleted"));
        setConfirm(null);
        router.refresh();
      } else toast.error(result.error);
    });
  };

  const duplicate = (id: string) => {
    setBusy(`dup:${id}`);
    startTransition(async () => {
      const result = await duplicatePostAction(id);
      setBusy(null);
      if (result.ok) {
        toast.success(result.message ?? t("blogAdmin.copied"));
        router.push(`/admin/blog/${result.data.id}`);
      } else toast.error(result.error);
    });
  };

  if (!rows.length) {
    return filtered ? (
      <EmptyState
        compact
        icon={<Icon.Search />}
        title={t("blogAdmin.table.noMatchTitle")}
        description={t("blogAdmin.table.noMatchDescription")}
        action={
          <ButtonLink href={clearHref} variant="outline" size="sm">
            {t("blog.index.showAll")}
          </ButtonLink>
        }
      />
    ) : (
      <EmptyState
        icon={<Icon.FileText />}
        title={t("blog.index.emptyTitle")}
        description={t("blogAdmin.table.emptyDescription")}
        action={
          <ButtonLink href="/admin/blog/new" leftIcon={<Icon.Plus className="size-4" />}>
            {t("blogAdmin.table.new")}
          </ButtonLink>
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-2" aria-live="polite">
        <p className="text-xs text-ink-muted">{chosen.length > 0 ? t("blogAdmin.table.selected", { count: chosen.length }) : t("blogAdmin.table.shown", { shown: rows.length, total })}</p>
        {chosen.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {BULK.map(({ op, label, icon }) => {
              const BulkIcon = Icon[icon];
              return (
                <Button key={op} size="sm" variant="outline" disabled={pending} onClick={() => runBulk(op, chosen)} leftIcon={busy === op ? <Spinner className="size-3.5" /> : <BulkIcon className="size-3.5" />}>
                  {t(label)}
                </Button>
              );
            })}
            <Button size="sm" variant="danger" disabled={pending} onClick={() => setConfirm({ kind: "delete", ids: chosen })} leftIcon={<Icon.Trash className="size-3.5" />}>
              {common("actions.delete")}
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
                aria-label={t("blogAdmin.table.selectAll")}
                checked={allChosen}
                onChange={(e) => setSelected(e.target.checked ? new Set(visibleIds) : new Set())}
              />
            </TH>
            <TH>{t("blogAdmin.table.article")}</TH>
            <TH className="hidden sm:table-cell">{t("blogAdmin.table.status")}</TH>
            {showAuthor && <TH className="hidden lg:table-cell">{t("blogAdmin.editor.author")}</TH>}
            <TH className="hidden text-end md:table-cell">{t("blogAdmin.table.views")}</TH>
            <TH className="hidden xl:table-cell">{t("blogAdmin.table.updated")}</TH>
            <TH className="w-12 text-end">
              <span className="sr-only">{t("blogAdmin.table.actions")}</span>
            </TH>
          </tr>
        </THead>
        <TBody>
          {rows.map((row) => {
            const status = { tone: POST_STATUS[row.status].tone, label: t(`blogAdmin.status.${row.status}`) };
            const items: DropdownItem[] = [
              { label: common("actions.edit"), icon: <Icon.Edit />, href: `/admin/blog/${row.id}` },
              { label: row.status === "published" ? t("blogAdmin.viewArticle") : t("blogAdmin.preview"), icon: <Icon.Eye />, href: `/blog/${row.slug}` },
              { label: t("blogAdmin.duplicate"), icon: <Icon.Copy />, onClick: () => duplicate(row.id) },
              { label: common("actions.delete"), icon: <Icon.Trash />, destructive: true, separator: true, onClick: () => setConfirm({ kind: "delete", ids: [row.id], title: row.title }) },
            ];
            return (
              <TR key={row.id}>
                <TD>
                  <input
                    type="checkbox"
                    className="size-4 cursor-pointer rounded border-border-strong accent-accent"
                    aria-label={t("blogAdmin.table.select", { title: row.title })}
                    checked={selected.has(row.id)}
                    onChange={(e) => toggle(row.id, e.target.checked)}
                  />
                </TD>
                <TD className="max-w-0">
                  <Link href={`/admin/blog/${row.id}`} className="block truncate font-medium text-ink hover:text-accent hover:underline">
                    {row.title || t("blogAdmin.untitled")}
                  </Link>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-muted">
                    <span className="truncate font-mono" dir="ltr">/blog/{row.slug}</span>
                    {row.categories && <span className="hidden truncate md:inline">· {row.categories}</span>}
                    {row.focusKeyword && (
                      <span className="inline-flex items-center gap-1">
                        <Icon.Target className="size-3" aria-hidden="true" />
                        <span className="sr-only">{t("blogAdmin.table.focusKeyword")}</span>
                        {row.focusKeyword}
                      </span>
                    )}
                  </p>
                  <p className="mt-1 flex flex-wrap gap-1 sm:hidden">
                    <Badge tone={status.tone} size="xs">
                      {status.label}
                    </Badge>
                    {row.noindex && (
                      <Badge tone="warning" size="xs">
                        {t("blogAdmin.table.noindex")}
                      </Badge>
                    )}
                  </p>
                </TD>
                <TD className="hidden sm:table-cell">
                  <div className="flex flex-wrap items-center gap-1">
                    <Badge tone={status.tone} size="xs" dot>
                      {status.label}
                    </Badge>
                    {row.noindex && (
                      <Badge tone="warning" size="xs">
                        {t("blogAdmin.table.noindex")}
                      </Badge>
                    )}
                  </div>
                  {row.dateLabel && <p className="mt-1 whitespace-nowrap text-xs text-ink-muted">{row.dateLabel}</p>}
                </TD>
                {showAuthor && <TD className="hidden truncate text-sm text-ink-muted lg:table-cell">{row.author}</TD>}
                <TD className="hidden text-end text-sm tabular-nums text-ink-muted md:table-cell">{row.views}</TD>
                <TD className="hidden whitespace-nowrap text-xs text-ink-muted xl:table-cell">{row.updatedLabel}</TD>
                <TD className="text-end">
                  <Dropdown
                    trigger={
                      <span className="inline-flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-2 hover:text-ink">
                        {busy === `dup:${row.id}` ? <Spinner className="size-4" /> : <Icon.MoreHorizontal className="size-4" />}
                        <span className="sr-only">{t("blogAdmin.table.actionsFor", { title: row.title })}</span>
                      </span>
                    }
                    items={items}
                  />
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>

      <ConfirmDialog
        open={!!confirm}
        onClose={() => (pending ? undefined : setConfirm(null))}
        onConfirm={remove}
        loading={busy === "delete"}
        destructive
        title={confirm && confirm.ids.length > 1 ? t("blogAdmin.deleteMany", { count: confirm.ids.length }) : confirm?.title ? t("blogAdmin.deleteOne", { title: confirm.title }) : t("blogAdmin.deleteThis")}
        description={t("blogAdmin.table.deleteDescription")}
        confirmLabel={common("actions.delete")}
      />
    </div>
  );
}
