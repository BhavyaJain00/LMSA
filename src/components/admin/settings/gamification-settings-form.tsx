"use client";

import type { Settings } from "@/lib/types";
import { saveGamificationSettingsAction } from "@/lib/actions/gamification";
import { Input, Switch } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { CONFIGURABLE_REASONS, MAX_REASON_POINTS, REASON_META } from "@/components/gamification/reasons";
import { SettingsRow, SettingsSection, SettingsSwitchRow } from "./settings-ui";
import { SaveBar } from "./save-bar";
import { useFormAction } from "./use-form-action";

export type GamificationValues = Settings["gamification"];

/** Points, leaderboard visibility and the value of every activity (admin). */
export function GamificationSettingsForm({ initial, guestAccess }: { initial: GamificationValues; guestAccess: boolean }) {
  const { onSubmit, pending, errors, dirty, markDirty, state } = useFormAction(saveGamificationSettingsAction);

  return (
    <form onSubmit={onSubmit} onChange={markDirty} noValidate className="space-y-6">
      <SettingsSection title="Points & leaderboard">
        <SettingsSwitchRow>
          <Switch
            name="enabled"
            defaultChecked={initial.enabled}
            label="Enable points and levels"
            description="Members earn points for learning activity and level up as they go. When turned off, no points are awarded and points, levels and the leaderboard are hidden everywhere."
          />
        </SettingsSwitchRow>
        <SettingsSwitchRow>
          <Switch
            name="showLeaderboard"
            defaultChecked={initial.showLeaderboard}
            label="Show the leaderboard"
            description={
              guestAccess
                ? "Adds a Leaderboard page with weekly, monthly and all-time rankings. Guests can see it too because guest access is on."
                : "Adds a Leaderboard page with weekly, monthly and all-time rankings for signed-in members."
            }
          />
        </SettingsSwitchRow>
        <SettingsSwitchRow>
          <Switch
            name="excludeStaff"
            defaultChecked={initial.excludeStaff}
            label="Leave admins and moderators out of rankings"
            description="Staff still earn points and levels, but they are not ranked on leaderboards."
          />
        </SettingsSwitchRow>
      </SettingsSection>

      <SettingsSection
        title="Points per activity"
        description="Set an activity to 0 to stop awarding points for it. New values apply to future activity; recalculate below to apply them to past activity too."
      >
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
                  {meta.label}
                </span>
              }
              description={meta.description}
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
                rightAddon={<span className="text-xs">pts</span>}
              />
            </SettingsRow>
          );
        })}
      </SettingsSection>

      <SaveBar dirty={dirty} pending={pending} saved={state?.ok} failed={state?.ok === false} />
    </form>
  );
}
