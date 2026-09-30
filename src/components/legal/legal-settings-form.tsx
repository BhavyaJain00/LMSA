"use client";

import type { Settings } from "@/lib/types";
import { saveLegalSettingsAction } from "@/lib/legal/actions";
import { RETENTION_MAX_DAYS, RETENTION_MIN_DAYS } from "@/lib/legal/retention";
import { Input, Switch, Textarea } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { SettingsRow, SettingsSection, SettingsSwitchRow } from "@/components/admin/settings/settings-ui";
import { SaveBar } from "@/components/admin/settings/save-bar";
import { useFormAction } from "@/components/admin/settings/use-form-action";

export type LegalSettingsValues = Settings["legal"];

/** Company details used in legal text, the cookie banner switch and the data retention period. */
export function LegalSettingsForm({ initial, fallbackContactEmail }: { initial: LegalSettingsValues; fallbackContactEmail?: string }) {
  const { onSubmit, pending, errors, dirty, markDirty, state } = useFormAction(saveLegalSettingsAction);

  return (
    <form onSubmit={onSubmit} onChange={markDirty} noValidate className="space-y-6">
      <SettingsSection title="Company details" description="Filled into legal pages wherever the text uses {{companyName}}, {{companyAddress}} or {{contactEmail}}.">
        <SettingsRow label="Company name" description="The legal entity that runs this site." htmlFor="companyName" error={errors.companyName} required>
          <Input id="companyName" name="companyName" defaultValue={initial.companyName} maxLength={120} invalid={!!errors.companyName} required />
        </SettingsRow>
        <SettingsRow label="Registered address" description="Shown in the privacy policy and terms. Optional." htmlFor="companyAddress" error={errors.companyAddress} stacked>
          <Textarea
            id="companyAddress"
            name="companyAddress"
            defaultValue={initial.companyAddress ?? ""}
            rows={2}
            maxLength={300}
            placeholder="Street, city, postcode, country"
            invalid={!!errors.companyAddress}
          />
        </SettingsRow>
        <SettingsRow
          label="Privacy contact email"
          description={fallbackContactEmail ? `Where members send privacy and legal requests. Empty = the site contact email (${fallbackContactEmail}).` : "Where members send privacy and legal requests."}
          htmlFor="contactEmail"
          error={errors.contactEmail}
        >
          <Input
            id="contactEmail"
            name="contactEmail"
            type="email"
            defaultValue={initial.contactEmail ?? ""}
            placeholder="privacy@example.com"
            leftAddon={<Icon.Mail className="size-4" />}
            invalid={!!errors.contactEmail}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Cookies and data retention">
        <SettingsSwitchRow error={errors.cookieBanner}>
          <Switch
            name="cookieBanner"
            defaultChecked={initial.cookieBanner}
            label="Ask visitors for cookie consent"
            description="Shows a banner on the first visit with Accept all, Reject non-essential and Customize. Analytics and marketing tags only load after the visitor agrees. When off, the banner is hidden but visitors can still choose from the “Cookie settings” link, and optional tags stay off until they do."
          />
        </SettingsSwitchRow>
        <SettingsRow
          label="Keep logs for"
          description={`Audit events, error reports and cookie-consent records older than this are deleted automatically (consent records are always kept for at least a year). Between ${RETENTION_MIN_DAYS} and ${RETENTION_MAX_DAYS} days.`}
          htmlFor="dataRetentionDays"
          error={errors.dataRetentionDays}
          required
        >
          <Input
            id="dataRetentionDays"
            name="dataRetentionDays"
            type="number"
            inputMode="numeric"
            min={RETENTION_MIN_DAYS}
            max={RETENTION_MAX_DAYS}
            step={1}
            defaultValue={initial.dataRetentionDays}
            rightAddon={<span className="text-xs text-ink-muted">days</span>}
            invalid={!!errors.dataRetentionDays}
          />
        </SettingsRow>
      </SettingsSection>

      <SaveBar dirty={dirty} pending={pending} saved={state?.ok} failed={state ? !state.ok : false} />
    </form>
  );
}
