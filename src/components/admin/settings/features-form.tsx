"use client";

import type { Settings } from "@/lib/types";
import { saveFeatureSettingsAction } from "@/lib/actions/settings";
import { Switch } from "@/components/ui/input";
import { useT } from "@/i18n/client";
import { SettingsSection, SettingsSwitchRow } from "./settings-ui";
import { SaveBar } from "./save-bar";
import { useFormAction } from "./use-form-action";

type FeatureKey = keyof Settings["features"];

const GROUPS: { id: "learning" | "community" | "career" | "insights"; items: FeatureKey[] }[] = [
  { id: "learning", items: ["courses", "batches", "programs", "liveClasses", "programmingExercises"] },
  { id: "community", items: ["discussions", "reviews", "notes", "badges", "notifications"] },
  { id: "career", items: ["certifications", "certifiedMembers", "jobs"] },
  { id: "insights", items: ["statistics"] },
];

export function FeaturesForm({ initial }: { initial: Settings["features"] }) {
  const t = useT("admin");
  const { onSubmit, pending, dirty, markDirty, state } = useFormAction(saveFeatureSettingsAction);
  return (
    <form onSubmit={onSubmit} onChange={markDirty} className="space-y-6">
      {GROUPS.map((group) => (
        <SettingsSection key={group.id} title={t(`featuresForm.groups.${group.id}.title`)} description={t(`featuresForm.groups.${group.id}.description`)}>
          {group.items.map((key) => (
            <SettingsSwitchRow key={key}>
              <Switch
                id={`feature-${key}`}
                name={key}
                defaultChecked={initial[key]}
                label={t(`featuresForm.items.${key}.label`)}
                description={t(`featuresForm.items.${key}.description`)}
              />
            </SettingsSwitchRow>
          ))}
        </SettingsSection>
      ))}
      <p className="text-xs text-ink-muted">{t("featuresForm.note")}</p>
      <SaveBar dirty={dirty} pending={pending} saved={state?.ok} failed={state?.ok === false} />
    </form>
  );
}
