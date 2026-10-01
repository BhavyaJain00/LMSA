"use client";

import { saveTrackingSettingsAction } from "@/lib/actions/seo-settings";
import { SaveBar } from "@/components/admin/settings/save-bar";
import { SettingsRow, SettingsSection } from "@/components/admin/settings/settings-ui";
import { useFormAction } from "@/components/admin/settings/use-form-action";
import { Input } from "@/components/ui/input";

/** GA4 measurement ID and Meta Pixel ID (Admin → Settings → SEO → Tracking). */
export function TrackingForm({ initial }: { initial: { ga4Id: string; metaPixelId: string } }) {
  const { onSubmit, pending, errors, dirty, markDirty, state } = useFormAction(saveTrackingSettingsAction);
  return (
    <form onSubmit={onSubmit} onChange={markDirty} noValidate>
      <SettingsSection title="Measurement tags" description="Leave a field empty to switch that tag off.">
        <SettingsRow
          label="Google Analytics 4"
          htmlFor="ga4Id"
          error={errors.ga4Id}
          description="Measurement ID of your web data stream (Google Analytics → Admin → Data streams). Loads after a visitor accepts analytics cookies."
        >
          <Input id="ga4Id" name="ga4Id" defaultValue={initial.ga4Id} placeholder="G-AB12CD34EF" autoComplete="off" spellCheck={false} className="font-mono" invalid={!!errors.ga4Id} />
        </SettingsRow>
        <SettingsRow
          label="Meta Pixel"
          htmlFor="metaPixelId"
          error={errors.metaPixelId}
          description="Pixel (dataset) ID from Meta Events Manager. Loads after a visitor accepts marketing cookies."
        >
          <Input id="metaPixelId" name="metaPixelId" defaultValue={initial.metaPixelId} placeholder="123456789012345" inputMode="numeric" autoComplete="off" spellCheck={false} className="font-mono" invalid={!!errors.metaPixelId} />
        </SettingsRow>
      </SettingsSection>
      <SaveBar dirty={dirty} pending={pending} saved={state?.ok} failed={state?.ok === false} />
    </form>
  );
}
