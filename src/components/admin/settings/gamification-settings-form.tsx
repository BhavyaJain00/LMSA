"use client";

import type { Settings } from "@/lib/types";
import { saveGamificationSettingsAction } from "@/lib/actions/gamification";
import { Input, Switch } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { CONFIGURABLE_REASONS, DISCUSSION_REPLY_DAILY_CAP, MAX_REASON_POINTS, REASON_META } from "@/components/gamification/reasons";
import { SettingsRow, SettingsSection, SettingsSwitchRow } from "./settings-ui";
import { SaveBar } from "./save-bar";
import { useFormAction } from "./use-form-action";
import { useT } from "@/i18n/client";

export type GamificationValues = Settings["gamification"];

/** Points, leaderboard visibility and the value of every activity (admin). */
export function GamificationSettingsForm({ initial, guestAccess }: { initial: GamificationValues; guestAccess: boolean }) {
  const t = useT("admin");
  const { onSubmit, pending, errors, dirty, markDirty, state } = useFormAction(saveGamificationSettingsAction);

  return (
    <form onSubmit={onSubmit} onChange={markDirty} noValidate className="space-y-6">
      <SettingsSection title={t("gamificationForm.section.title")}>
        <SettingsSwitchRow>
          <Switch
            name="enabled"
            defaultChecked={initial.enabled}
            label={t("gamificationForm.enabled.label")}
            description={t("gamificationForm.enabled.description")}
          />
        </SettingsSwitchRow>
        <SettingsSwitchRow>
          <Switch
            name="showLeaderboard"
            defaultChecked={initial.showLeaderboard}
            label={t("gamificationForm.leaderboard.label")}
            description={guestAccess ? t("gamificationForm.leaderboard.descriptionGuests") : t("gamificationForm.leaderboard.description")}
          />
        </SettingsSwitchRow>
        <SettingsSwitchRow>
          <Switch
            name="excludeStaff"
            defaultChecked={initial.excludeStaff}
            label={t("gamificationForm.excludeStaff.label")}
            description={t("gamificationForm.excludeStaff.description")}
          />
        </SettingsSwitchRow>
      </SettingsSection>

      <SettingsSection title={t("gamificationForm.points.title")} description={t("gamificationForm.points.description")}>
        {CONFIGURABLE_REASONS.map((reason) => {
          const meta = REASON_META[reason];
          const IconCmp = Icon[meta.icon];
          const name = `points_${reason}`;
          return (
            <SettingsRow
              key={reason}
              htmlFor={name}
              label={
                <span className="inline-flex items-center gap-2">
                  <IconCmp className="size-4 text-ink-faint" aria-hidden="true" />
                  {t(`pointsReasons.${reason}.label`)}
                </span>
              }
              description={t(`pointsReasons.${reason}.description`, { cap: DISCUSSION_REPLY_DAILY_CAP })}
              error={errors[name]}
              required
            >
              <Input
                id={name}
                name={name}
                type="number"
                inputMode="numeric"
                min={0}
                max={MAX_REASON_POINTS}
                step={1}
                defaultValue={initial.points[reason]}
                invalid={!!errors[name]}
                rightAddon={<span className="text-xs">{t("gamificationForm.points.unit")}</span>}
              />
            </SettingsRow>
          );
        })}
      </SettingsSection>

      <SaveBar dirty={dirty} pending={pending} saved={state?.ok} failed={state?.ok === false} />
    </form>
  );
}
