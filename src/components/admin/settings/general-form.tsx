"use client";

import type { Settings } from "@/lib/types";
import { saveGeneralSettingsAction } from "@/lib/actions/settings";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
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
  const { onSubmit, pending, errors, dirty, markDirty, state } = useFormAction(saveGeneralSettingsAction);

  return (
    <form onSubmit={onSubmit} onChange={markDirty} noValidate className="space-y-6">
      <SettingsSection title="Brand" description="How your platform introduces itself across the app.">
        <SettingsRow label="Brand name" description="Set the name of your brand. Appears in the left sidebar and the browser tab." htmlFor="name" error={errors.name} required>
          <Input id="name" name="name" defaultValue={initial.name} placeholder="Enter Brand Name" maxLength={60} invalid={!!errors.name} required />
        </SettingsRow>
        <SettingsRow label="Tagline" description="A short line shown on the landing page hero." htmlFor="tagline" error={errors.tagline}>
          <Input id="tagline" name="tagline" defaultValue={initial.tagline} placeholder="Learn by doing." maxLength={140} invalid={!!errors.tagline} />
        </SettingsRow>
        <SettingsRow label="Footer text" description="Shown at the bottom of every page, e.g. a copyright line. Leave empty to hide the footer." htmlFor="footerText" error={errors.footerText} stacked>
          <Textarea id="footerText" name="footerText" defaultValue={initial.footerText} rows={2} maxLength={300} placeholder="© 2026 Your Academy. All rights reserved." invalid={!!errors.footerText} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Contact information" description="Powers the 'Contact us' link in the sidebar. A URL takes precedence over an email address.">
        <SettingsRow label="Email" description="Where learners can reach your team." htmlFor="contactEmail" error={errors.contactEmail}>
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
        <SettingsRow label="URL" description="A contact or help-center page (http or https)." htmlFor="contactUrl" error={errors.contactUrl}>
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

      <SettingsSection title="Preferences">
        <SettingsRow label="Text direction" description="Auto follows the language of the site." htmlFor="textDirection" error={errors.textDirection}>
          <Select
            id="textDirection"
            name="textDirection"
            defaultValue={initial.textDirection}
            options={[
              { value: "auto", label: "Auto" },
              { value: "ltr", label: "Left to Right" },
              { value: "rtl", label: "Right to Left" },
            ]}
          />
        </SettingsRow>
      </SettingsSection>

      <SaveBar dirty={dirty} pending={pending} saved={state?.ok} failed={state?.ok === false} />
    </form>
  );
}
