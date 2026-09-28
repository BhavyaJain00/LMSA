"use client";

import { useState } from "react";
import { saveSeoSettingsAction } from "@/lib/actions/settings";
import { FileUpload } from "@/components/ui/file-upload";
import { Textarea } from "@/components/ui/input";
import { cn, truncate } from "@/lib/utils";
import { SettingsRow, SettingsSection } from "./settings-ui";
import { SaveBar } from "./save-bar";
import { useFormAction } from "./use-form-action";

export interface SeoValues {
  brandName: string;
  siteUrl: string;
  metaDescription: string;
  metaKeywords: string;
  metaImageUrl: string;
}

const DESCRIPTION_LIMIT = 160;

export function SeoForm({ initial }: { initial: SeoValues }) {
  const { onSubmit, pending, errors, dirty, markDirty, state } = useFormAction(saveSeoSettingsAction);
  const [description, setDescription] = useState(initial.metaDescription);
  const [imageUrl, setImageUrl] = useState(initial.metaImageUrl);

  return (
    <form onSubmit={onSubmit} onChange={markDirty} noValidate className="space-y-6">
      <SettingsSection title="SEO" description="Default meta tags used by search engines and social networks.">
        <SettingsRow
          label="Meta Description"
          description="This description will be shown on lists and pages that don't have meta description"
          htmlFor="metaDescription"
          error={errors.metaDescription}
          stacked
        >
          <Textarea
            id="metaDescription"
            name="metaDescription"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={300}
            invalid={!!errors.metaDescription}
            placeholder="A self-hosted learning platform with courses, cohorts and certificates."
          />
          <p className={cn("mt-1 text-right text-xs", description.length > DESCRIPTION_LIMIT ? "text-warning" : "text-ink-faint")}>
            {description.length}/{DESCRIPTION_LIMIT} recommended
          </p>
        </SettingsRow>
        <SettingsRow
          label="Meta Keywords"
          description="Comma separated keywords for search engines to find your website."
          htmlFor="metaKeywords"
          error={errors.metaKeywords}
          stacked
        >
          <Textarea id="metaKeywords" name="metaKeywords" rows={3} defaultValue={initial.metaKeywords} invalid={!!errors.metaKeywords} placeholder="lms, online courses, training" />
        </SettingsRow>
        <SettingsRow label="Meta Image" description="Default social-share image used when pages lack their own meta image. 1200×630 px works best." error={errors.metaImageUrl} stacked>
          <FileUpload
            name="metaImageUrl"
            kind="image"
            value={imageUrl}
            onChange={(url) => {
              setImageUrl(url);
              markDirty();
            }}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Search result preview" description="An approximation of how your home page may appear in search results.">
        <div className="px-4 py-4 sm:px-5">
          <div className="max-w-xl rounded-xl border border-border bg-surface-1 p-4">
            <p className="truncate text-xs text-ink-muted">{initial.siteUrl}</p>
            <p className="mt-0.5 truncate text-lg text-info">{initial.brandName}</p>
            <p className="mt-1 text-sm text-ink-muted">{description ? truncate(description, DESCRIPTION_LIMIT) : "Add a meta description to control this snippet."}</p>
          </div>
        </div>
      </SettingsSection>

      <SaveBar dirty={dirty} pending={pending} saved={state?.ok} />
    </form>
  );
}
