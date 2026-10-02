"use client";

import { useId } from "react";
import { POST_LIMITS } from "@/lib/seo/blog";
import { type SeoCheck, type SeoCheckStatus, seoScore } from "@/lib/seo/focus-keyword";
import { DESCRIPTION_MAX, DESCRIPTION_MIN, TITLE_MAX, TITLE_MIN } from "@/lib/seo/text";
import { CharCounter } from "@/components/seo/char-counter";
import { SnippetPreview } from "@/components/seo/snippet-preview";
import { Icon } from "@/components/ui/icons";
import { Field, Input, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";

const STATUS_STYLE = {
  pass: { icon: "CheckCircleFilled", className: "text-success", label: "blogAdmin.seo.good" },
  warn: { icon: "AlertTriangle", className: "text-warning", label: "blogAdmin.seo.couldBeBetter" },
  fail: { icon: "XCircle", className: "text-danger", label: "blogAdmin.seo.needsWork" },
} as const satisfies Record<SeoCheckStatus, { icon: "CheckCircleFilled" | "AlertTriangle" | "XCircle"; className: string; label: string }>;

function scoreTone(score: number): string {
  if (score >= 80) return "bg-success/15 text-success";
  if (score >= 50) return "bg-warning/15 text-warning";
  return "bg-danger/15 text-danger";
}

/**
 * SEO panel of the article editor: SEO title and meta description with
 * character counters, a live Google result preview, the focus keyword and
 * the on-page checks (keyword in title, H1, first paragraph, slug, meta
 * description and subheadings; density; lengths) with an overall score.
 * The parent owns the values and runs `analyzeSeo`.
 */
export function SeoPanel({
  url,
  documentTitle,
  fallbackTitle,
  seoTitle,
  onSeoTitle,
  seoDescription,
  onSeoDescription,
  previewDescription,
  focusKeyword,
  onFocusKeyword,
  checks,
  errors,
}: {
  url: string;
  /** The `<title>` as search engines will see it (site template applied). */
  documentTitle: string;
  /** The article title, used when no SEO title is set. */
  fallbackTitle: string;
  seoTitle: string;
  onSeoTitle: (value: string) => void;
  seoDescription: string;
  onSeoDescription: (value: string) => void;
  /** What the page will use as its description (generated when the field is empty). */
  previewDescription: string;
  focusKeyword: string;
  onFocusKeyword: (value: string) => void;
  checks: SeoCheck[];
  errors: Record<string, string>;
}) {
  const t = useT("public");
  const id = useId();
  const score = seoScore(checks);
  const passed = checks.filter((c) => c.status === "pass").length;

  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-xs font-medium text-ink-muted">{t("blogAdmin.seo.preview")}</p>
        <SnippetPreview url={url} title={documentTitle} description={previewDescription} />
      </div>

      <Field label={t("blogAdmin.seo.title")} htmlFor={`${id}-title`} error={errors.seoTitle} hint={seoTitle ? undefined : t("blogAdmin.seo.titleEmpty", { title: fallbackTitle || t("blogAdmin.untitled") })}>
        <Input
          id={`${id}-title`}
          name="seoTitle"
          value={seoTitle}
          maxLength={POST_LIMITS.seoTitle}
          placeholder={fallbackTitle || t("blogAdmin.seo.titlePlaceholder")}
          invalid={!!errors.seoTitle}
          onChange={(e) => onSeoTitle(e.target.value)}
        />
        <CharCounter length={documentTitle.length} min={TITLE_MIN} max={TITLE_MAX} />
      </Field>

      <Field label={t("blogAdmin.seo.description")} htmlFor={`${id}-desc`} error={errors.seoDescription} hint={seoDescription ? undefined : t("blogAdmin.seo.descriptionEmpty")}>
        <Textarea
          id={`${id}-desc`}
          name="seoDescription"
          value={seoDescription}
          rows={3}
          maxLength={POST_LIMITS.seoDescription}
          placeholder={t("blogAdmin.seo.descriptionPlaceholder")}
          invalid={!!errors.seoDescription}
          onChange={(e) => onSeoDescription(e.target.value)}
        />
        <CharCounter length={seoDescription.length} min={DESCRIPTION_MIN} max={DESCRIPTION_MAX} />
      </Field>

      <Field label={t("blogAdmin.seo.keyword")} htmlFor={`${id}-kw`} error={errors.focusKeyword} hint={t("blogAdmin.seo.keywordHint")}>
        <Input
          id={`${id}-kw`}
          name="focusKeyword"
          value={focusKeyword}
          maxLength={POST_LIMITS.focusKeyword}
          leftAddon={<Icon.Target className="size-4" />}
          invalid={!!errors.focusKeyword}
          onChange={(e) => onFocusKeyword(e.target.value)}
        />
      </Field>

      <div className="rounded-xl border border-border">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-ink">{t("blogAdmin.seo.checks")}</h3>
          <p className="flex items-center gap-2 text-xs text-ink-muted">
            <span>{t("blogAdmin.seo.passed", { passed, total: checks.length })}</span>
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums", scoreTone(score))} aria-label={t("blogAdmin.seo.score", { score })}>
              {score}
            </span>
          </p>
        </div>
        <ul className="divide-y divide-border" aria-live="polite">
          {checks.map((check) => {
            const style = STATUS_STYLE[check.status];
            const StatusIcon = Icon[style.icon];
            return (
              <li key={check.id} className="flex items-start gap-2.5 px-4 py-2.5">
                <StatusIcon className={cn("mt-0.5 size-4 shrink-0", style.className)} aria-hidden="true" />
                <p className="min-w-0 text-sm">
                  <span className="font-medium text-ink">{check.label}</span>
                  <span className="sr-only"> ({t(style.label)})</span>
                  <span className="text-ink-muted"> — {check.detail}</span>
                </p>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
