"use client";

import { useState } from "react";
import { saveCategorySeoAction } from "@/lib/actions/seo-settings";
import { CATEGORY_SEO_LIMITS } from "@/lib/seo/settings";
import { DESCRIPTION_MAX, DESCRIPTION_MIN, TITLE_MAX, TITLE_MIN, metaDescription } from "@/lib/seo/text";
import { useFormAction } from "@/components/admin/settings/use-form-action";
import { CharCounter } from "@/components/seo/char-counter";
import { SnippetPreview } from "@/components/seo/snippet-preview";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { Input, Textarea } from "@/components/ui/input";

export interface CategoryLandingValues {
  id: string;
  name: string;
  slug: string;
  intro: string;
  seoTitle: string;
  seoDescription: string;
}

/**
 * Editor of a category's landing page (`/courses/category/<slug>`): the
 * introduction shown above the course list and the title and description
 * used in search results, with a live result preview. Mounted by the
 * categories manager; keyed by category so it opens with that category's text.
 */
export function CategoryLandingDialog({ category, siteUrl, brandName, onClose }: { category: CategoryLandingValues; siteUrl: string; brandName: string; onClose: () => void }) {
  const [intro, setIntro] = useState(category.intro);
  const [seoTitle, setSeoTitle] = useState(category.seoTitle);
  const [seoDescription, setSeoDescription] = useState(category.seoDescription);
  const { onSubmit, pending, errors, dirty, markDirty } = useFormAction(saveCategorySeoAction, { onSuccess: onClose });

  const path = `/courses/category/${category.slug}`;
  const fallbackTitle = `${category.name} courses`;
  const fallbackDescription = metaDescription(intro, `Browse ${category.name.toLowerCase()} courses on ${brandName}: self-paced video lessons, quizzes, hands-on assignments and certificates.`);
  const formId = `category-landing-${category.id}`;

  return (
    <Dialog
      open
      onClose={() => (pending ? undefined : onClose())}
      title={`${category.name} landing page`}
      description="Visitors and search engines land on this page when they look for courses in this category."
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={pending} disabled={!dirty}>
            Save
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} onChange={markDirty} noValidate className="space-y-5">
        <input type="hidden" name="id" value={category.id} />

        <div>
          <label htmlFor={`${formId}-intro`} className="block text-sm font-medium text-ink">
            Introduction
          </label>
          <p className="mt-0.5 text-xs text-ink-muted">
            Shown above the course list. Say who these courses are for and what learners will be able to do. Markdown is supported (headings, lists, links).
          </p>
          <Textarea
            id={`${formId}-intro`}
            name="intro"
            rows={7}
            className="mt-2"
            value={intro}
            onChange={(e) => setIntro(e.target.value)}
            maxLength={CATEGORY_SEO_LIMITS.intro}
            invalid={!!errors.intro}
            placeholder={`Learn ${category.name.toLowerCase()} step by step, from the fundamentals to real projects…`}
          />
          {errors.intro && (
            <p className="mt-1 text-xs text-danger" role="alert">
              {errors.intro}
            </p>
          )}
        </div>

        <div>
          <label htmlFor={`${formId}-title`} className="block text-sm font-medium text-ink">
            Search title
          </label>
          <p className="mt-0.5 text-xs text-ink-muted">Leave empty to use “{fallbackTitle}”.</p>
          <Input
            id={`${formId}-title`}
            name="seoTitle"
            className="mt-2"
            value={seoTitle}
            onChange={(e) => setSeoTitle(e.target.value)}
            maxLength={CATEGORY_SEO_LIMITS.seoTitle}
            invalid={!!errors.seoTitle}
            placeholder={fallbackTitle}
          />
          <CharCounter length={seoTitle.trim().length} min={TITLE_MIN} max={TITLE_MAX} />
          {errors.seoTitle && (
            <p className="text-xs text-danger" role="alert">
              {errors.seoTitle}
            </p>
          )}
        </div>

        <div>
          <label htmlFor={`${formId}-description`} className="block text-sm font-medium text-ink">
            Search description
          </label>
          <p className="mt-0.5 text-xs text-ink-muted">The text under the title in search results. Leave empty to build it from the introduction.</p>
          <Textarea
            id={`${formId}-description`}
            name="seoDescription"
            rows={3}
            className="mt-2"
            value={seoDescription}
            onChange={(e) => setSeoDescription(e.target.value)}
            maxLength={CATEGORY_SEO_LIMITS.seoDescription}
            invalid={!!errors.seoDescription}
          />
          <CharCounter length={seoDescription.trim().length} min={DESCRIPTION_MIN} max={DESCRIPTION_MAX} />
          {errors.seoDescription && (
            <p className="text-xs text-danger" role="alert">
              {errors.seoDescription}
            </p>
          )}
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-ink">Search result preview</p>
          <SnippetPreview url={`${siteUrl}${path}`} title={`${seoTitle.trim() || fallbackTitle} · ${brandName}`} description={seoDescription.trim() || fallbackDescription} />
        </div>

        <a href={path} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
          Open the page
          <Icon.ExternalLink className="size-3.5" aria-hidden="true" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </form>
    </Dialog>
  );
}
