"use client";

import { useState } from "react";
import type { Settings } from "@/lib/types";
import { savePwaSettingsAction } from "@/lib/actions/pwa-settings";
import { Switch } from "@/components/ui/input";
import { SettingsSection, SettingsSwitchRow } from "./settings-ui";
import { SaveBar } from "./save-bar";
import { useFormAction } from "./use-form-action";

export function PwaSettingsForm({ initial }: { initial: Settings["pwa"] }) {
  const { onSubmit, pending, dirty, markDirty, state } = useFormAction(savePwaSettingsAction);
  const [enabled, setEnabled] = useState(initial.enabled);

  return (
    <form onSubmit={onSubmit} onChange={markDirty} noValidate className="space-y-6">
      <input type="hidden" name="section" value="pwa" />
      <SettingsSection title="App & offline support" description="Applies to every member on phones, tablets and desktops.">
        <SettingsSwitchRow>
          <Switch
            name="enabled"
            checked={enabled}
            onChange={(e) => setEnabled(e.currentTarget.checked)}
            label="Installable app"
            description="Members can add the site to their home screen or desktop and open it in its own window. Also turns on the service worker that makes pages load faster and shows an offline page. Turning it off removes the service worker from browsers on their next visit."
          />
        </SettingsSwitchRow>
        <SettingsSwitchRow>
          <Switch
            name="installPrompt"
            defaultChecked={initial.installPrompt}
            disabled={!enabled}
            label="Suggest installing the app"
            description="Shows a small install card when the browser supports installation, and Add to Home Screen steps on iPhone and iPad. Members who dismiss it aren't asked again for 14 days."
          />
        </SettingsSwitchRow>
        <SettingsSwitchRow>
          <Switch
            name="offlinePage"
            defaultChecked={initial.offlinePage}
            disabled={!enabled}
            label="Offline page"
            description="When a page can't load, show a branded offline screen with a Try again button and the pages saved on the device, instead of the browser's error page."
          />
        </SettingsSwitchRow>
        {!enabled && (
          <p className="px-4 py-3 text-xs text-ink-muted sm:px-5">Turn on the installable app to change the install card and offline page options.</p>
        )}
      </SettingsSection>

      <SaveBar dirty={dirty} pending={pending} saved={state?.ok} failed={state?.ok === false} />
    </form>
  );
}
