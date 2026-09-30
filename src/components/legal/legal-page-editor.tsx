"use client";

import Link from "next/link";
import { useDeferredValue, useRef, useState, useTransition, type FormEvent } from "react";
import { deleteLegalPageAction, restoreLegalTemplateAction, saveLegalPageAction } from "@/lib/legal/actions";
import {
  fillLegalPlaceholders,
  isTemplateContent,
  LEGAL_CONTENT_MAX,
  LEGAL_PLACEHOLDERS,
  LEGAL_TITLE_MAX,
  legalHref,
  removeTemplateNotice,
  type LegalPlaceholderValues,
} from "@/lib/legal/pages-shared";
import { Markdown } from "@/lib/markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, FormError, Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { SegmentedControl } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { useFormAction } from "@/components/admin/settings/use-form-action";
import { UnsavedChangesGuard } from "@/components/admin/settings/unsaved-changes-guard";
import { cn, formatDateTime } from "@/lib/utils";

export interface LegalEditorPage {
  slug: string;
  title: string;
  content: string;
  published: boolean;
  version: number;
  updatedAt: string;
  /** False for a standard page that has never been saved (the starter template is shown). */
  stored: boolean;
}

type Mode = "write" | "preview";
type PendingConfirm = "unpublish" | "restore" | "delete" | null;

/**
 * Markdown editor for one legal page: write and live preview side by side on
 * wide screens (tabs on phones), placeholder chips, the "review with a
 * lawyer" template banner, and publish / unpublish / restore / delete.
 */
export function LegalPageEditor({ page: initial, isCore, placeholders }: { page: LegalEditorPage; isCore: boolean; placeholders: LegalPlaceholderValues }) {
  const toast = useToast();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [page, setPage] = useState(initial);
  const [title, setTitle] = useState(initial.title);
  const [content, setContent] = useState(initial.content);
  const [mode, setMode] = useState<Mode>("write");
  const [confirm, setConfirm] = useState<PendingConfirm>(null);
  const [busy, startTransition] = useTransition();
  const deferred = useDeferredValue(content);
  const dirty = title !== page.title || content !== page.content;
  const template = isTemplateContent(content);

  const { submit, pending, errors, formError } = useFormAction(saveLegalPageAction, {
    toastError: true,
    onSuccess: (result) => {
      setPage((p) => ({ ...p, ...result.data, title: title.trim(), stored: true }));
      setContent(result.data.content);
      setTitle((t) => t.trim());
    },
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const data = new FormData(event.currentTarget, submitter instanceof HTMLButtonElement ? submitter : null);
    submit(data);
  };

  const sendIntent = (intent: "unpublish") => {
    const data = new FormData();
    data.set("slug", page.slug);
    data.set("intent", intent);
    data.set("title", title);
    data.set("content", content);
    submit(data);
    setConfirm(null);
  };

  const insertToken = (token: string) => {
    const el = textarea.current;
    const start = el?.selectionStart ?? content.length;
    const end = el?.selectionEnd ?? content.length;
    const next = content.slice(0, start) + token + content.slice(end);
    setContent(next);
    setMode("write");
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const restore = () =>
    startTransition(async () => {
      const result = await restoreLegalTemplateAction(page.slug);
      setConfirm(null);
      if (!result.ok) return void toast.error(result.error);
      setPage((p) => ({ ...p, ...result.data, stored: true }));
      setContent(result.data.content);
      toast.success(result.message ?? "Template restored");
    });

  const remove = () =>
    startTransition(async () => {
      const result = await deleteLegalPageAction(page.slug);
      setConfirm(null);
      if (result && !result.ok) toast.error(result.error);
    });

  const working = pending || busy;
  const status = page.published ? (
    <Badge tone="success" dot>
      Published · v{page.version}
    </Badge>
  ) : page.stored ? (
    <Badge tone="warning" dot>
      Draft{page.version > 0 ? ` · last published v${page.version}` : ""}
    </Badge>
  ) : (
    <Badge tone="neutral" dot>
      Starter template
    </Badge>
  );

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <input type="hidden" name="slug" value={page.slug} />

      <div className="flex flex-col gap-3 rounded-card border border-border bg-surface-1 px-4 py-3 shadow-card sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {status}
          {dirty && (
            <Badge tone="warning" dot>
              Not saved
            </Badge>
          )}
          <span className="text-ink-muted">
            {page.published ? "Last updated" : "Last saved"} {page.stored ? formatDateTime(page.updatedAt) : "never"}
          </span>
        </div>
        {page.published && (
          <Link href={legalHref(page.slug)} target="_blank" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
            View live page <Icon.ExternalLink className="size-3.5" />
          </Link>
        )}
      </div>

      {template && (
        <div role="note" className="flex flex-col gap-3 rounded-card border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-ink sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-2.5">
            <Icon.AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            <div>
              <p className="font-semibold">Template — review with a lawyer before publishing</p>
              <p className="mt-0.5 text-ink-muted">
                This is generic starter text. Laws differ by country and business; have it checked, adapt it to how you actually collect and use data, then remove the notice to
                publish.
              </p>
            </div>
          </div>
          <Button size="sm" variant="outline" className="shrink-0" onClick={() => setContent(removeTemplateNotice(content))}>
            Remove notice
          </Button>
        </div>
      )}

      <FormError message={formError && !Object.keys(errors).length ? formError : null} />

      <Field label="Title" htmlFor="legal-page-title" required error={errors.title}>
        <Input id="legal-page-title" name="title" value={title} maxLength={LEGAL_TITLE_MAX} invalid={!!errors.title} onChange={(e) => setTitle(e.target.value)} />
      </Field>

      <div>
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <div>
            <label htmlFor="legal-page-content" className="block text-sm font-medium text-ink">
              Text <span className="text-danger">*</span>
            </label>
            <p className="text-xs text-ink-muted">Markdown: ## for headings, - for lists, **bold**, [links](https://…).</p>
          </div>
          <SegmentedControl<Mode>
            className="lg:hidden"
            value={mode}
            onChange={setMode}
            options={[
              { value: "write", label: "Write" },
              { value: "preview", label: "Preview" },
            ]}
          />
        </div>

        <div className="mb-2 flex flex-wrap items-center gap-1.5" aria-label="Insert a placeholder">
          <span className="text-xs text-ink-muted">Insert:</span>
          {LEGAL_PLACEHOLDERS.map((p) => (
            <button
              key={p.token}
              type="button"
              title={p.description}
              onClick={() => insertToken(p.token)}
              className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-muted hover:border-border-strong hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              {p.token}
            </button>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className={cn(mode === "preview" && "hidden lg:block")}>
            <textarea
              ref={textarea}
              id="legal-page-content"
              name="content"
              value={content}
              maxLength={LEGAL_CONTENT_MAX}
              aria-invalid={!!errors.content || undefined}
              aria-describedby={errors.content ? "legal-page-content-error" : undefined}
              onChange={(e) => setContent(e.target.value)}
              rows={24}
              spellCheck
              className={cn(
                "block min-h-80 w-full resize-y rounded-lg border bg-surface-1 px-3 py-2 font-mono text-[13px] leading-relaxed text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 lg:h-144",
                errors.content ? "border-danger focus:ring-danger/25" : "border-border-strong focus:border-accent focus:ring-accent/25",
              )}
            />
            <p className="mt-1 text-right text-xs tabular-nums text-ink-faint">
              {content.length.toLocaleString("en-US")} / {LEGAL_CONTENT_MAX.toLocaleString("en-US")}
            </p>
          </div>
          <section
            aria-label="Preview"
            className={cn("min-h-80 overflow-y-auto rounded-lg border border-border bg-surface-1 px-4 py-3 lg:h-144", mode === "write" && "hidden lg:block")}
          >
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Preview</p>
            {deferred.trim() ? (
              <Markdown content={fillLegalPlaceholders(deferred, { ...placeholders, updatedAt: new Date().toISOString() })} />
            ) : (
              <p className="text-sm italic text-ink-faint">Nothing to preview yet.</p>
            )}
          </section>
        </div>
        {errors.content && (
          <p id="legal-page-content-error" className="mt-1.5 text-xs text-danger" role="alert">
            {errors.content}
          </p>
        )}
      </div>

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-col-reverse gap-3 rounded-xl border border-border bg-surface-1/95 px-4 py-3 shadow-card backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {isCore ? (
            <Button variant="ghost" size="sm" leftIcon={<Icon.Refresh className="size-4" />} onClick={() => setConfirm("restore")} disabled={working}>
              Restore template
            </Button>
          ) : (
            <Button variant="ghost" size="sm" className="text-danger" leftIcon={<Icon.Trash className="size-4" />} onClick={() => setConfirm("delete")} disabled={working}>
              Delete page
            </Button>
          )}
          {page.published && (
            <Button variant="ghost" size="sm" leftIcon={<Icon.EyeOff className="size-4" />} onClick={() => setConfirm("unpublish")} disabled={working}>
              Unpublish
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          {!page.published && (
            <Button type="submit" name="intent" value="save" variant="outline" loading={pending} disabled={working || (!dirty && page.stored)}>
              Save draft
            </Button>
          )}
          <Button type="submit" name="intent" value="publish" loading={pending} disabled={working || (page.published && !dirty)} leftIcon={<Icon.Globe className="size-4" />}>
            {page.published ? "Publish changes" : "Publish"}
          </Button>
        </div>
      </div>
      {page.published && <p className="text-xs text-ink-muted">Changes to a published page go live as a new version when you publish them.</p>}

      <UnsavedChangesGuard when={dirty && !working} />

      <ConfirmDialog
        open={confirm === "unpublish"}
        onClose={() => setConfirm(null)}
        onConfirm={() => sendIntent("unpublish")}
        title="Unpublish this page?"
        description="Visitors get a “page not found” and the footer, sign-up and checkout links to it disappear until you publish it again."
        confirmLabel="Unpublish"
        loading={pending}
      />
      <ConfirmDialog
        open={confirm === "restore"}
        onClose={() => setConfirm(null)}
        onConfirm={restore}
        title="Restore the starter template?"
        description="The current text is replaced by the original template and the page is unpublished until you review and publish it again."
        confirmLabel="Restore template"
        destructive
        loading={busy}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onClose={() => setConfirm(null)}
        onConfirm={remove}
        title="Delete this page?"
        description="The page and its text are removed permanently. Links to it will show “page not found”."
        confirmLabel="Delete page"
        destructive
        loading={busy}
      />
    </form>
  );
}
