"use client";

import { useState } from "react";
import type { Settings } from "@/lib/types";
import { saveSecuritySettingsAction } from "@/lib/actions/security";
import { Input, Switch } from "@/components/ui/input";
import { SettingsRow, SettingsSection, SettingsSwitchRow } from "./settings-ui";
import { SaveBar } from "./save-bar";
import { useFormAction } from "./use-form-action";

export type SecuritySettingsValues = Settings["security"];

/** Admin → Settings → Security: verification, two-step verification, lockout and password rules. */
export function SecuritySettingsForm({ initial, adminHasTwoFactor }: { initial: SecuritySettingsValues; adminHasTwoFactor: boolean }) {
  const { onSubmit, pending, errors, dirty, markDirty, state } = useFormAction(saveSecuritySettingsAction);
  const [allowTwoFactor, setAllowTwoFactor] = useState(initial.allowTwoFactor);
  const [enforce, setEnforce] = useState(initial.enforceTwoFactorForStaff);

  return (
    <form onSubmit={onSubmit} onChange={markDirty} noValidate className="space-y-6">
      <SettingsSection title="Email verification">
        <SettingsSwitchRow error={errors.requireEmailVerification}>
          <Switch
            name="requireEmailVerification"
            defaultChecked={initial.requireEmailVerification}
            label="Require a confirmed email to enroll and purchase"
            description="New members get a confirmation link when they sign up. Until they confirm, they can browse and learn from free previews but can't enroll or pay. Accounts created by admins count as confirmed."
          />
        </SettingsSwitchRow>
      </SettingsSection>

      <SettingsSection title="Two-step verification">
        <SettingsSwitchRow error={errors.allowTwoFactor}>
          <Switch
            name="allowTwoFactor"
            checked={allowTwoFactor}
            onChange={(e) => {
              setAllowTwoFactor(e.target.checked);
              if (!e.target.checked) setEnforce(false);
            }}
            label="Allow two-step verification"
            description="Members can protect their account with an authenticator app (TOTP) and recovery codes. Members who already use it keep it when this is turned off."
          />
        </SettingsSwitchRow>
        <SettingsSwitchRow error={errors.enforceTwoFactorForStaff}>
          <Switch
            name="enforceTwoFactorForStaff"
            checked={enforce}
            disabled={!allowTwoFactor}
            onChange={(e) => setEnforce(e.target.checked)}
            label="Require two-step verification for staff"
            description="Admins, moderators, course creators and evaluators must set it up before they can open admin and teaching pages."
          />
          {enforce && !adminHasTwoFactor && (
            <p className="mt-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-ink">
              Turn on two-step verification for your own account first (Settings → Security), or you would be sent to set it up before reaching admin pages.
            </p>
          )}
        </SettingsSwitchRow>
      </SettingsSection>

      <SettingsSection title="Sign-in protection">
        <SettingsRow
          label="Failed attempts before lockout"
          description="Consecutive wrong passwords or codes before sign-in is paused for the account. Between 3 and 20."
          htmlFor="maxLoginAttempts"
          error={errors.maxLoginAttempts}
          required
        >
          <Input id="maxLoginAttempts" name="maxLoginAttempts" type="number" inputMode="numeric" min={3} max={20} step={1} defaultValue={initial.maxLoginAttempts} invalid={!!errors.maxLoginAttempts} />
        </SettingsRow>
        <SettingsRow
          label="Lockout duration (minutes)"
          description="How long sign-in stays paused after too many failures. Members can still reset their password by email. Between 1 and 1440."
          htmlFor="lockoutMinutes"
          error={errors.lockoutMinutes}
          required
        >
          <Input id="lockoutMinutes" name="lockoutMinutes" type="number" inputMode="numeric" min={1} max={1440} step={1} defaultValue={initial.lockoutMinutes} invalid={!!errors.lockoutMinutes} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Passwords">
        <SettingsRow
          label="Minimum password length"
          description="Applies to sign-up, password changes and resets. Passwords must also contain letters and numbers. Between 8 and 64."
          htmlFor="passwordMinLength"
          error={errors.passwordMinLength}
          required
        >
          <Input id="passwordMinLength" name="passwordMinLength" type="number" inputMode="numeric" min={8} max={64} step={1} defaultValue={initial.passwordMinLength} invalid={!!errors.passwordMinLength} />
        </SettingsRow>
      </SettingsSection>

      <SaveBar dirty={dirty} pending={pending} saved={state?.ok} failed={state?.ok === false} />
    </form>
  );
}
