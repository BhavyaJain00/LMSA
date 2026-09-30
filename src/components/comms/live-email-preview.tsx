"use client";

import { useEffect, useRef, useState } from "react";
import { previewEmailAction } from "@/lib/actions/broadcasts";
import type { CampaignKind } from "@/lib/comms/campaign-core";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { EmailFrame } from "./email-frame";

interface Rendered {
  key: string;
  subject?: string;
  html?: string;
  problems?: string[];
  error?: string;
}

const RENDER_DELAY_MS = 500;

/**
 * The email exactly as it will arrive (brand header, footer, placeholders
 * filled with the viewer's own name), re-rendered on the server shortly after
 * the content changes. Nothing is sent or tracked.
 */
export function LiveEmailPreview({
  kind,
  subject,
  preheader,
  body,
  courseId,
  heightClass,
}: {
  kind: CampaignKind;
  subject: string;
  preheader?: string;
  body: string;
  /** Sequence emails: the course behind `{{ course_title }}` and `{{ course_url }}`. */
  courseId?: string;
  heightClass?: string;
}) {
  const [rendered, setRendered] = useState<Rendered | null>(null);
  const [retry, setRetry] = useState(0);
  const request = useRef(0);
  const key = JSON.stringify([kind, subject, preheader ?? "", body, courseId ?? "", retry]);
  const loading = rendered?.key !== key;

  useEffect(() => {
    const mine = ++request.current;
    const timer = setTimeout(
      async () => {
        let next: Rendered;
        try {
          const result = await previewEmailAction({ kind, subject, preheader, body, courseId });
          next = result.ok ? { key, subject: result.data.subject, html: result.data.html, problems: result.data.problems } : { key, error: result.error };
        } catch {
          next = { key, error: "The preview couldn't be loaded. Check your connection and try again." };
        }
        if (mine !== request.current) return;
        // Keep the last good render visible behind an error.
        setRendered((prev) => (next.error ? { ...next, subject: prev?.subject, html: prev?.html } : next));
      },
      rendered ? RENDER_DELAY_MS : 0,
    );
    return () => clearTimeout(timer);
    // `key` covers every input; `rendered` only decides the first delay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <div className="space-y-3" aria-live="polite">
      {rendered?.error && !loading && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          <span>{rendered.error}</span>
          <Button size="xs" variant="outline" onClick={() => setRetry((n) => n + 1)} leftIcon={<Icon.Refresh className="size-3.5" />}>
            Try again
          </Button>
        </div>
      )}
      {!!rendered?.problems?.length && !loading && (
        <ul className="space-y-1 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          {rendered.problems.map((problem) => (
            <li key={problem} className="flex gap-2">
              <Icon.AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{problem}</span>
            </li>
          ))}
        </ul>
      )}
      {rendered?.html ? (
        <EmailFrame subject={rendered.subject ?? subject} html={rendered.html} busy={loading} heightClass={heightClass} />
      ) : rendered?.error ? null : (
        <div className="space-y-3 rounded-card border border-border p-4">
          <span className="sr-only">Rendering the preview…</span>
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}
      <p className="text-xs text-ink-muted">
        Shown with your own name in place of the recipient&apos;s. Each recipient gets their own unsubscribe link in the footer.
      </p>
    </div>
  );
}
