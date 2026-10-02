"use client";

import type { Settings } from "@/lib/types";
import { saveGeneralSettingsAction } from "@/lib/actions/settings";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { useT } from "@/i18n/client";
import { SettingsRow, SettingsSection } from "./settings-ui";
import { SaveBar } from "./save-bar";
import { useFormAction } from "./use-form-action";

export interface GeneralSettingsValues {
  name: string;
  tagline: string;
  footerText: string;
  contactEmail: string;
  contactUrl: string;
  textDirection: Settings["textDirection"];
}

export function GeneralSettingsForm({ initial }: { initial: GeneralSettingsValues }) {
  const t = useT("admin");
  const { onSubmit, pending, errors, dirty, markDirty, state } = useFormAction(saveGeneralSettingsAction);

  return (
    <form onSubmit={onSubmit} onChange={markDirty} noValidate className="space-y-6">
      <SettingsSection title={t("generalForm.brand.title")} description={t("generalForm.brand.description")}>
        <SettingsRow label={t("generalForm.name.label")} description={t("generalForm.name.description")} htmlFor="name" error={errors.name} required>
          <Input id="name" name="name" defaultValue={initial.name} placeholder={t("generalForm.name.placeholder")} maxLength={60} invalid={!!errors.name} required />
        </SettingsRow>
        <SettingsRow label={t("generalForm.tagline.label")} description={t("generalForm.tagline.description")} htmlFor="tagline" error={errors.tagline}>
          <Input id="tagline" name="tagline" defaultValue={initial.tagline} placeholder={t("generalForm.tagline.placeholder")} maxLength={140} invalid={!!errors.tagline} />
        </SettingsRow>
        <SettingsRow label={t("generalForm.footer.label")} description={t("generalForm.footer.description")} htmlFor="footerText" error={errors.footerText} stacked>
          <Textarea id="footerText" name="footerText" defaultValue={initial.footerText} rows={2} maxLength={300} placeholder={t("generalForm.footer.placeholder")} invalid={!!errors.footerText} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t("generalForm.contact.title")} description={t("generalForm.contact.description")}>
        <SettingsRow label={t("generalForm.contactEmail.label")} description={t("generalForm.contactEmail.description")} htmlFor="contactEmail" error={errors.contactEmail}>
          <Input
            id="contactEmail"
            name="contactEmail"
            type="email"
            defaultValue={initial.contactEmail}
            placeholder="support@example.com"
            leftAddon={<Icon.Mail className="size-4" />}
            invalid={!!errors.contactEmail}
          />
        </SettingsRow>
        <SettingsRow label={t("generalForm.contactUrl.label")} description={t("generalForm.contactUrl.description")} htmlFor="contactUrl" error={errors.contactUrl}>
          <Input
            id="contactUrl"
            name="contactUrl"
            type="url"
            defaultValue={initial.contactUrl}
            placeholder="https://example.com/contact"
            leftAddon={<Icon.Globe className="size-4" />}
            invalid={!!errors.contactUrl}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t("generalForm.preferences.title")}>
        <SettingsRow label={t("generalForm.direction.label")} description={t("generalForm.direction.description")} htmlFor="textDirection" error={errors.textDirection}>
          <Select
            id="textDirection"
            name="textDirection"
            defaultValue={initial.textDirection}
            options={[
              { value: "auto", label: t("generalForm.direction.auto") },
              { value: "ltr", label: t("generalForm.direction.ltr") },
              { value: "rtl", label: t("generalForm.direction.rtl") },
            ]}
          />
        </SettingsRow>
      </SettingsSection>

      <SaveBar dirty={dirty} pending={pending} saved={state?.ok} failed={state?.ok === false} />
    </form>
  );
}
