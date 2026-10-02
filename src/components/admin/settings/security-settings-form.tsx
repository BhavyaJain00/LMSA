"use client";

import { useState } from "react";
import type { Settings } from "@/lib/types";
import { saveSecuritySettingsAction } from "@/lib/actions/security";
import { Input, Switch } from "@/components/ui/input";
import { SettingsRow, SettingsSection, SettingsSwitchRow } from "./settings-ui";
import { SaveBar } from "./save-bar";
import { useFormAction } from "./use-form-action";
import { useT } from "@/i18n/client";

export type SecuritySettingsValues = Settings["security"];

/** Admin → Settings → Security: verification, two-step verification, lockout and password rules. */
export function SecuritySettingsForm({ initial, adminHasTwoFactor }: { initial: SecuritySettingsValues; adminHasTwoFactor: boolean }) {
  const t = useT("admin");
  const { onSubmit, pending, errors, dirty, markDirty, state } = useFormAction(saveSecuritySettingsAction);
  const [allowTwoFactor, setAllowTwoFactor] = useState(initial.allowTwoFactor);
  const [enforce, setEnforce] = useState(initial.enforceTwoFactorForStaff);

  return (
    <form onSubmit={onSubmit} onChange={markDirty} noValidate className="space-y-6">
      <SettingsSection title={t("securityForm.verification.title")}>
        <SettingsSwitchRow error={errors.requireEmailVerification}>
          <Switch
            name="requireEmailVerification"
            defaultChecked={initial.requireEmailVerification}
            label={t("securityForm.verification.label")}
            description={t("securityForm.verification.description")}
          />
        </SettingsSwitchRow>
      </SettingsSection>

      <SettingsSection title={t("securityForm.twoFactor.title")}>
        <SettingsSwitchRow error={errors.allowTwoFactor}>
          <Switch
            name="allowTwoFactor"
            checked={allowTwoFactor}
            onChange={(e) => {
              setAllowTwoFactor(e.target.checked);
              if (!e.target.checked) setEnforce(false);
            }}
            label={t("securityForm.twoFactor.allowLabel")}
            description={t("securityForm.twoFactor.allowDescription")}
          />
        </SettingsSwitchRow>
        <SettingsSwitchRow error={errors.enforceTwoFactorForStaff}>
          <Switch
            name="enforceTwoFactorForStaff"
            checked={enforce}
            disabled={!allowTwoFactor}
            onChange={(e) => setEnforce(e.target.checked)}
            label={t("securityForm.twoFactor.enforceLabel")}
            description={t("securityForm.twoFactor.enforceDescription")}
          />
          {enforce && !adminHasTwoFactor && (
            <p className="mt-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-ink">
              {t("securityForm.twoFactor.ownWarning")}
            </p>
          )}
        </SettingsSwitchRow>
      </SettingsSection>

      <SettingsSection title={t("securityForm.signIn.title")}>
        <SettingsRow
          label={t("securityForm.attempts.label")}
          description={t("securityForm.attempts.description")}
          htmlFor="maxLoginAttempts"
          error={errors.maxLoginAttempts}
          required
        >
          <Input
            id="maxLoginAttempts"
            name="maxLoginAttempts"
            type="number"
            inputMode="numeric"
            min={3}
            max={20}
            step={1}
            defaultValue={initial.maxLoginAttempts}
            invalid={!!errors.maxLoginAttempts}
          />
        </SettingsRow>
        <SettingsRow
          label={t("securityForm.lockout.label")}
          description={t("securityForm.lockout.description")}
          htmlFor="lockoutMinutes"
          error={errors.lockoutMinutes}
          required
        >
          <Input
            id="lockoutMinutes"
            name="lockoutMinutes"
            type="number"
            inputMode="numeric"
            min={1}
            max={1440}
            step={1}
            defaultValue={initial.lockoutMinutes}
            invalid={!!errors.lockoutMinutes}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t("securityForm.passwords.title")}>
        <SettingsRow
          label={t("securityForm.passwords.label")}
          description={t("securityForm.passwords.description")}
          htmlFor="passwordMinLength"
          error={errors.passwordMinLength}
          required
        >
          <Input
            id="passwordMinLength"
            name="passwordMinLength"
            type="number"
            inputMode="numeric"
            min={8}
            max={64}
            step={1}
            defaultValue={initial.passwordMinLength}
            invalid={!!errors.passwordMinLength}
          />
        </SettingsRow>
      </SettingsSection>

      <SaveBar dirty={dirty} pending={pending} saved={state?.ok} failed={state?.ok === false} />
    </form>
  );
}
