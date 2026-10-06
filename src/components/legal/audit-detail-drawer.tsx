"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";

export interface AuditDetail {
  id: string;
  action: string;
  actionLabel: string;
  /** Pre-formatted on the server (one time zone for the whole page). */
  when: string;
  whenIso: string;
  relative: string;
  actor: { name: string; email?: string; href?: string } | null;
  target: { typeLabel: string; id: string; href: string | null } | null;
  ip?: string;
  meta: { key: string; value: string }[];
  /** "Show all events by this member", … */
  related: { label: string; href: string }[];
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <IconButton
      label={copied ? "Copied" : label}
      size="icon-sm"
      onClick={() => {
        navigator.clipboard?.writeText(value).then(
          () => setCopied(true),
          () => undefined,
        );
      }}
    >
      {copied ? <Icon.Check className="size-3.5 text-success" /> : <Icon.Copy className="size-3.5" />}
    </IconButton>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 py-2.5 text-sm">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="min-w-0 text-ink">{children}</dd>
    </div>
  );
}

/**
 * Side drawer with everything recorded for one audit event. Driven by the
 * `?event=` query parameter so an event can be linked to; closing (Esc, the
 * backdrop or ×) removes the parameter.
 */
export function AuditDetailDrawer({ detail, closeHref }: { detail: AuditDetail; closeHref: string }) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);

  const close = useCallback(() => {
    ref.current?.close();
    router.replace(closeHref, { scroll: false });
  }, [router, closeHref]);

  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, [detail.id]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      close();
    };
    el.addEventListener("cancel", onCancel);
    return () => el.removeEventListener("cancel", onCancel);
  }, [close]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="audit-detail-title"
      className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-dvh w-full max-w-md border-l border-border bg-surface-1 p-0 text-ink shadow-pop backdrop:bg-black/40 open:animate-fade-in"
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Audit event</p>
            <h2 id="audit-detail-title" className="mt-0.5 text-base font-semibold">
              {detail.actionLabel}
            </h2>
            <p className="mt-1 font-mono text-xs text-ink-muted">{detail.action}</p>
          </div>
          <IconButton label="Close" size="icon-sm" onClick={close} className="-mr-1">
            <Icon.X className="size-4" />
          </IconButton>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          <dl className="divide-y divide-border">
            <Row label="When">
              <time dateTime={detail.whenIso}>{detail.when}</time>
              <span className="block text-xs text-ink-muted">{detail.relative}</span>
            </Row>
            <Row label="Done by">
              {detail.actor ? (
                <>
                  {detail.actor.href ? (
                    <Link href={detail.actor.href} className="font-medium text-accent hover:underline">
                      {detail.actor.name}
                    </Link>
                  ) : (
                    <span className="font-medium">{detail.actor.name}</span>
                  )}
                  {detail.actor.email && <span className="block break-all text-xs text-ink-muted">{detail.actor.email}</span>}
                </>
              ) : (
                <Badge tone="neutral">System</Badge>
              )}
            </Row>
            <Row label="Target">
              {detail.target ? (
                <>
                  <span className="font-medium">{detail.target.typeLabel}</span>
                  <span className="flex items-center gap-1">
                    <span className="min-w-0 truncate font-mono text-xs text-ink-muted" title={detail.target.id}>
                      {detail.target.id}
                    </span>
                    <CopyButton value={detail.target.id} label="Copy target id" />
                  </span>
                  {detail.target.href && (
                    <Link href={detail.target.href} className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
                      Open <Icon.ArrowRight className="size-3.5 rtl:rotate-180" />
                    </Link>
                  )}
                </>
              ) : (
                <span className="text-ink-muted">—</span>
              )}
            </Row>
            <Row label="IP address">{detail.ip ? <span className="font-mono text-xs">{detail.ip}</span> : <span className="text-ink-muted">Not recorded</span>}</Row>
            <Row label="Event id">
              <span className="flex items-center gap-1">
                <span className="min-w-0 truncate font-mono text-xs text-ink-muted">{detail.id}</span>
                <CopyButton value={detail.id} label="Copy event id" />
              </span>
            </Row>
          </dl>

          <h3 className="mt-5 mb-2 text-sm font-semibold">Details</h3>
          {detail.meta.length ? (
            <dl className="divide-y divide-border rounded-lg border border-border">
              {detail.meta.map((m) => (
                <div key={m.key} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 px-3 py-2 text-xs">
                  <dt className="break-words font-mono text-ink-muted">{m.key}</dt>
                  <dd className="break-words font-mono text-ink">{m.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-ink-muted">No extra details were recorded.</p>
          )}

          {detail.related.length > 0 && (
            <>
              <h3 className="mt-5 mb-2 text-sm font-semibold">Related</h3>
              <ul className="space-y-1">
                {detail.related.map((r) => (
                  <li key={r.href}>
                    <Link href={r.href} scroll={false} className="inline-flex items-center gap-1.5 text-sm text-accent hover:underline">
                      <Icon.Filter className="size-3.5" />
                      {r.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </dialog>
  );
}
