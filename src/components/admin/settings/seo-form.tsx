"use client";

import { useState } from "react";
import { saveSeoSettingsAction } from "@/lib/actions/seo-settings";
import { DESCRIPTION_MAX, DESCRIPTION_MIN, applyTitleTemplate } from "@/lib/seo/text";
import { SEO_SETTINGS_LIMITS } from "@/lib/seo/settings";
import { FileUpload } from "@/components/ui/file-upload";
import { Input, Switch, Textarea } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { cn, truncate } from "@/lib/utils";
import { SettingsRow, SettingsSection, SettingsSwitchRow } from "./settings-ui";
import { SaveBar } from "./save-bar";
import { useFormAction } from "./use-form-action";

export interface SeoValues {
  brandName: string;
  tagline: string;
  /** Canonical origin (APP_URL) shown in the snippet preview. */
  siteUrl: string;
  siteTitleTemplate: string;
  metaDescription: string;
  metaKeywords: string;
  metaImageUrl: string;
  twitterHandle: string;
  organizationName: string;
  organizationLogoUrl: string;
  sameAs: string[];
  googleVerification: string;
  bingVerification: string;
  noindexSite: boolean;
}

/** Character counter coloured by the 120–160 range search engines show in full. */
function DescriptionCounter({ length }: { length: number }) {
  const tone = length === 0 ? "text-ink-faint" : length > DESCRIPTION_MAX ? "text-warning" : length < DESCRIPTION_MIN ? "text-ink-muted" : "text-success";
  const hint = length === 0 ? "" : length > DESCRIPTION_MAX ? " · may be cut off" : length < DESCRIPTION_MIN ? " · room for more" : " · good length";
  return (
    <p className={cn("mt-1 text-right text-xs", tone)} aria-live="polite">
      {length}/{DESCRIPTION_MAX}
      {hint}
    </p>
  );
}

export function SeoForm({ initial }: { initial: SeoValues }) {
  const { onSubmit, pending, errors, dirty, markDirty, state } = useFormAction(saveSeoSettingsAction);
  const [template, setTemplate] = useState(initial.siteTitleTemplate);
  const [description, setDescription] = useState(initial.metaDescription);
  const [imageUrl, setImageUrl] = useState(initial.metaImageUrl);
  const [logoUrl, setLogoUrl] = useState(initial.organizationLogoUrl);
  const [noindex, setNoindex] = useState(initial.noindexSite);

  const homeTitle = initial.tagline ? `${initial.brandName} — ${initial.tagline}` : initial.brandName;
  const sampleTitle = template.includes("%s") ? applyTitleTemplate(template, "Introduction to JavaScript") : "Include %s in the template";

  return (
    <form onSubmit={onSubmit} onChange={markDirty} noValidate className="space-y-6">
      {noindex && (
        <div role="alert" className="flex items-start gap-3 rounded-card border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-ink">
          <Icon.EyeOff className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
          <p>
            <span className="font-medium">Search engines are asked not to index this site.</span>{" "}
            <span className="text-ink-muted">Every page carries a noindex tag. Turn this off before launch or your pages will disappear from search results.</span>
          </p>
        </div>
      )}

      <SettingsSection title="Search appearance" description="How your pages are titled and described in search results and link previews.">
        <SettingsRow
          label="Title template"
          description={
            <>
              Applied to every page title. <code className="rounded bg-surface-2 px-1">%s</code> is replaced by the page name. Example: {sampleTitle}
            </>
          }
          htmlFor="siteTitleTemplate"
          error={errors.siteTitleTemplate}
          required
        >
          <Input
            id="siteTitleTemplate"
            name="siteTitleTemplate"
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            maxLength={SEO_SETTINGS_LIMITS.titleTemplate}
            placeholder={`%s · ${initial.brandName}`}
            invalid={!!errors.siteTitleTemplate}
            required
          />
        </SettingsRow>
        <SettingsRow
          label="Default meta description"
          description="Used on the home page and on any page without its own description. Aim for 120–160 characters that tell searchers what they will learn."
          htmlFor="metaDescription"
          error={errors.metaDescription}
          stacked
        >
          <Textarea
            id="metaDescription"
            name="metaDescription"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={SEO_SETTINGS_LIMITS.description}
            invalid={!!errors.metaDescription}
            placeholder="Hands-on online courses with video lessons, quizzes, live cohorts and certificates."
          />
          <DescriptionCounter length={description.trim().length} />
        </SettingsRow>
        <SettingsRow label="Keywords" description="Comma separated. Few search engines still read them; they also feed the site's default keywords." htmlFor="metaKeywords" error={errors.metaKeywords} stacked>
          <Textarea id="metaKeywords" name="metaKeywords" rows={2} defaultValue={initial.metaKeywords} invalid={!!errors.metaKeywords} placeholder="online courses, web development, certificates" />
        </SettingsRow>
        <SettingsRow
          label="Default share image"
          description="Shown when a page without its own image is shared on social networks. Use 1200×630 px. Leave empty to use the generated brand card."
          error={errors.metaImageUrl}
          stacked
        >
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
        <SettingsRow label="X (Twitter) handle" description="Credited on shared links (twitter:site)." htmlFor="twitterHandle" error={errors.twitterHandle}>
          <Input id="twitterHandle" name="twitterHandle" defaultValue={initial.twitterHandle} placeholder="@yourbrand" autoComplete="off" spellCheck={false} invalid={!!errors.twitterHandle} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Search result preview" description="An approximation of how the home page may appear on Google.">
        <div className="px-4 py-4 sm:px-5">
          <div className="max-w-xl rounded-xl border border-border bg-surface p-4">
            <p className="truncate text-xs text-ink-muted">{initial.siteUrl}</p>
            <p className="mt-0.5 truncate text-lg text-info">{homeTitle}</p>
            <p className="mt-1 text-sm text-ink-muted">{description.trim() ? truncate(description.trim(), DESCRIPTION_MAX) : "Add a meta description to control this snippet."}</p>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="Organization" description="Describes who runs the site in structured data (Google's knowledge panel, logo in results, course provider).">
        <SettingsRow label="Organization name" description="Usually your company or school name." htmlFor="organizationName" error={errors.organizationName} required>
          <Input
            id="organizationName"
            name="organizationName"
            defaultValue={initial.organizationName}
            maxLength={SEO_SETTINGS_LIMITS.organizationName}
            invalid={!!errors.organizationName}
            required
          />
        </SettingsRow>
        <SettingsRow label="Logo" description="A square logo of at least 112×112 px. Empty = the logo from Branding." error={errors.organizationLogoUrl} stacked>
          <FileUpload
            name="organizationLogoUrl"
            kind="image"
            value={logoUrl}
            onChange={(url) => {
              setLogoUrl(url);
              markDirty();
            }}
          />
        </SettingsRow>
        <SettingsRow
          label="Official profiles"
          description="One URL per line: LinkedIn, YouTube, X, Instagram, Wikipedia… Search engines use them to connect your brand's profiles."
          htmlFor="sameAs"
          error={errors.sameAs}
          stacked
        >
          <Textarea
            id="sameAs"
            name="sameAs"
            rows={3}
            defaultValue={initial.sameAs.join("\n")}
            placeholder={"https://www.linkedin.com/company/yourbrand\nhttps://www.youtube.com/@yourbrand"}
            spellCheck={false}
            invalid={!!errors.sameAs}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Search engine verification" description="Prove you own the site to see search performance, submit sitemaps and fix indexing problems.">
        <SettingsRow
          label="Google Search Console"
          description="Search Console → Add property → URL prefix → HTML tag. Paste the token or the whole meta tag."
          htmlFor="googleVerification"
          error={errors.googleVerification}
          stacked
        >
          <Input
            id="googleVerification"
            name="googleVerification"
            defaultValue={initial.googleVerification}
            placeholder='<meta name="google-site-verification" content="…" />'
            autoComplete="off"
            spellCheck={false}
            invalid={!!errors.googleVerification}
          />
        </SettingsRow>
        <SettingsRow
          label="Bing Webmaster Tools"
          description="Add a site → HTML Meta Tag option (msvalidate.01). Paste the token or the whole meta tag."
          htmlFor="bingVerification"
          error={errors.bingVerification}
          stacked
        >
          <Input
            id="bingVerification"
            name="bingVerification"
            defaultValue={initial.bingVerification}
            placeholder='<meta name="msvalidate.01" content="…" />'
            autoComplete="off"
            spellCheck={false}
            invalid={!!errors.bingVerification}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Indexing">
        <SettingsSwitchRow error={errors.noindexSite}>
          <Switch
            name="noindexSite"
            checked={noindex}
            onChange={(e) => setNoindex(e.target.checked)}
            label="Hide the whole site from search engines"
            description="Adds noindex to every page and blocks crawling in robots.txt. Use it for staging copies or before launch; account, admin and checkout pages are always hidden."
          />
        </SettingsSwitchRow>
      </SettingsSection>

      <SaveBar dirty={dirty} pending={pending} saved={state?.ok} failed={state?.ok === false} />
    </form>
  );
}
