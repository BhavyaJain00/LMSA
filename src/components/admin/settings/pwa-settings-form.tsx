"use client";

import { useState } from "react";
import type { Settings } from "@/lib/types";
import { savePwaSettingsAction } from "@/lib/actions/pwa-settings";
import { Switch } from "@/components/ui/input";
import { SettingsSection, SettingsSwitchRow } from "./settings-ui";
import { SaveBar } from "./save-bar";
import { useFormAction } from "./use-form-action";
import { useT } from "@/i18n/client";

export function PwaSettingsForm({ initial }: { initial: Settings["pwa"] }) {
  const t = useT("admin");
  const { onSubmit, pending, dirty, markDirty, state } = useFormAction(savePwaSettingsAction);
  const [enabled, setEnabled] = useState(initial.enabled);

  return (
    <form onSubmit={onSubmit} onChange={markDirty} noValidate className="space-y-6">
      <input type="hidden" name="section" value="pwa" />
      <SettingsSection title={t("pwaForm.section.title")} description={t("pwaForm.section.description")}>
        <SettingsSwitchRow>
          <Switch
            name="enabled"
            checked={enabled}
            onChange={(e) => setEnabled(e.currentTarget.checked)}
            label={t("pwaForm.enabled.label")}
            description={t("pwaForm.enabled.description")}
          />
        </SettingsSwitchRow>
        <SettingsSwitchRow>
          <Switch
            name="installPrompt"
            defaultChecked={initial.installPrompt}
            disabled={!enabled}
            label={t("pwaForm.prompt.label")}
            description={t("pwaForm.prompt.description")}
          />
        </SettingsSwitchRow>
        <SettingsSwitchRow>
          <Switch
            name="offlinePage"
            defaultChecked={initial.offlinePage}
            disabled={!enabled}
            label={t("pwaForm.offline.label")}
            description={t("pwaForm.offline.description")}
          />
        </SettingsSwitchRow>
        {!enabled && (
          <p className="px-4 py-3 text-xs text-ink-muted sm:px-5">{t("pwaForm.disabledNote")}</p>
        )}
      </SettingsSection>

      <SaveBar dirty={dirty} pending={pending} saved={state?.ok} failed={state?.ok === false} />
    </form>
  );
}
