"use client";

import { useState } from "react";
import { saveSeoSettingsAction } from "@/lib/actions/seo-settings";
import { DESCRIPTION_MAX, DESCRIPTION_MIN, applyTitleTemplate } from "@/lib/seo/text";
import { SEO_SETTINGS_LIMITS } from "@/lib/seo/settings";
import { FileUpload } from "@/components/ui/file-upload";
import { Input, Switch, Textarea } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { CharCounter } from "@/components/seo/char-counter";
import { SnippetPreview } from "@/components/seo/snippet-preview";
import { SettingsRow, SettingsSection, SettingsSwitchRow } from "./settings-ui";
import { SaveBar } from "./save-bar";
import { useFormAction } from "./use-form-action";
import { useT } from "@/i18n/client";

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
  blogEnabled: boolean;
}

export function SeoForm({ initial }: { initial: SeoValues }) {
  const t = useT("admin");
  const { onSubmit, pending, errors, dirty, markDirty, state } = useFormAction(saveSeoSettingsAction);
  const [template, setTemplate] = useState(initial.siteTitleTemplate);
  const [description, setDescription] = useState(initial.metaDescription);
  const [imageUrl, setImageUrl] = useState(initial.metaImageUrl);
  const [logoUrl, setLogoUrl] = useState(initial.organizationLogoUrl);
  const [noindex, setNoindex] = useState(initial.noindexSite);

  const homeTitle = initial.tagline ? `${initial.brandName} — ${initial.tagline}` : initial.brandName;
  const sampleTitle = template.includes("%s") ? applyTitleTemplate(template, t("seoForm.samplePage")) : t("seoForm.includePlaceholder");

  return (
    <form onSubmit={onSubmit} onChange={markDirty} noValidate className="space-y-6">
      {noindex && (
        <div role="alert" className="flex items-start gap-3 rounded-card border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-ink">
          <Icon.EyeOff className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
          <p>
            <span className="font-medium">{t("seoForm.noindexWarning")}</span>{" "}
            <span className="text-ink-muted">{t("seoForm.noindexWarningDetail")}</span>
          </p>
        </div>
      )}

      <SettingsSection title={t("seoForm.appearance.title")} description={t("seoForm.appearance.description")}>
        <SettingsRow
          label={t("seoForm.template.label")}
          description={
            t.rich("seoForm.template.description", {
              token: (
                <code className="rounded bg-surface-2 px-1" dir="ltr">
                  %s
                </code>
              ),
              example: sampleTitle,
            })
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
          label={t("seoForm.description.label")}
          description={t("seoForm.description.description")}
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
            placeholder={t("seoForm.description.placeholder")}
          />
          <CharCounter length={description.trim().length} min={DESCRIPTION_MIN} max={DESCRIPTION_MAX} />
        </SettingsRow>
        <SettingsRow label={t("seoForm.keywords.label")} description={t("seoForm.keywords.description")} htmlFor="metaKeywords" error={errors.metaKeywords} stacked>
          <Textarea id="metaKeywords" name="metaKeywords" rows={2} defaultValue={initial.metaKeywords} invalid={!!errors.metaKeywords} placeholder={t("seoForm.keywords.placeholder")} />
        </SettingsRow>
        <SettingsRow
          label={t("seoForm.image.label")}
          description={t("seoForm.image.description")}
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
        <SettingsRow label={t("seoForm.twitter.label")} description={t("seoForm.twitter.description")} htmlFor="twitterHandle" error={errors.twitterHandle}>
          <Input id="twitterHandle" name="twitterHandle" defaultValue={initial.twitterHandle} placeholder="@yourbrand" autoComplete="off" spellCheck={false} invalid={!!errors.twitterHandle} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t("seoForm.preview.title")} description={t("seoForm.preview.description")}>
        <div className="px-4 py-4 sm:px-5">
          <SnippetPreview url={initial.siteUrl} title={homeTitle} description={description} />
        </div>
      </SettingsSection>

      <SettingsSection title={t("seoForm.organization.title")} description={t("seoForm.organization.description")}>
        <SettingsRow label={t("seoForm.organization.name")} description={t("seoForm.organization.nameDescription")} htmlFor="organizationName" error={errors.organizationName} required>
          <Input
            id="organizationName"
            name="organizationName"
            defaultValue={initial.organizationName}
            maxLength={SEO_SETTINGS_LIMITS.organizationName}
            invalid={!!errors.organizationName}
            required
          />
        </SettingsRow>
        <SettingsRow label={t("seoForm.organization.logo")} description={t("seoForm.organization.logoDescription")} error={errors.organizationLogoUrl} stacked>
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
          label={t("seoForm.organization.profiles")}
          description={t("seoForm.organization.profilesDescription")}
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

      <SettingsSection title={t("seoForm.verification.title")} description={t("seoForm.verification.description")}>
        <SettingsRow
          label="Google Search Console"
          description={t("seoForm.verification.google")}
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
          description={t("seoForm.verification.bing")}
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

      <SettingsSection title={t("seoForm.blog.title")}>
        <SettingsSwitchRow error={errors.blogEnabled}>
          <Switch
            name="blogEnabled"
            defaultChecked={initial.blogEnabled}
            label={t("seoForm.blog.label")}
            description={t("seoForm.blog.description")}
          />
        </SettingsSwitchRow>
      </SettingsSection>

      <SettingsSection title={t("seoForm.indexing.title")}>
        <SettingsSwitchRow error={errors.noindexSite}>
          <Switch
            name="noindexSite"
            checked={noindex}
            onChange={(e) => setNoindex(e.target.checked)}
            label={t("seoForm.indexing.label")}
            description={t("seoForm.indexing.description")}
          />
        </SettingsSwitchRow>
      </SettingsSection>

      <SaveBar dirty={dirty} pending={pending} saved={state?.ok} failed={state?.ok === false} />
    </form>
  );
}
