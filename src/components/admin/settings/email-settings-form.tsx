"use client";

import { useState } from "react";
import type { NotificationType, Settings } from "@/lib/types";
import { saveEmailSettingsAction } from "@/lib/actions/email-settings";
import { NOTIFICATION_TYPE_OPTIONS } from "@/lib/email/preferences";
import { Checkbox, Input, Switch, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SettingsRow, SettingsSection, SettingsSwitchRow } from "./settings-ui";
import { SaveBar } from "./save-bar";
import { useFormAction } from "./use-form-action";
import { useT } from "@/i18n/client";

export type EmailSettingsValues = Settings["email"];

/** Settings → Email: master switch, sender identity, footer and which notifications are emailed. */
export function EmailSettingsForm({ initial, senderAddress }: { initial: EmailSettingsValues; senderAddress: string | null }) {
  const t = useT("admin");
  const { onSubmit, pending, errors, dirty, markDirty, state } = useFormAction(saveEmailSettingsAction);
  const [types, setTypes] = useState<Set<NotificationType>>(new Set(initial.notifyTypes));
  const [enabled, setEnabled] = useState(initial.enabled);
  const [fromName, setFromName] = useState(initial.fromName);

  const toggleType = (type: NotificationType) => {
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
    markDirty();
  };
  const setAll = (on: boolean) => {
    setTypes(on ? new Set(NOTIFICATION_TYPE_OPTIONS.map((o) => o.value)) : new Set());
    markDirty();
  };

  return (
    <form onSubmit={onSubmit} onChange={markDirty} noValidate className="space-y-6">
      <SettingsSection title={t("emailSettingsForm.notifications.title")}>
        <SettingsSwitchRow>
          <Switch
            name="enabled"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            label={t("emailSettingsForm.enabled.label")}
            description={t("emailSettingsForm.enabled.description")}
          />
        </SettingsSwitchRow>
        <SettingsRow
          label={t("emailSettingsForm.types.label")}
          description={t("emailSettingsForm.types.description")}
          error={errors.notifyTypes}
          stacked
        >
          <div className={enabled ? "" : "pointer-events-none opacity-60"} aria-disabled={!enabled}>
            <div className="mb-3 flex gap-2">
              <Button size="xs" variant="subtle" onClick={() => setAll(true)} disabled={!enabled}>
                {t("emailSettingsForm.types.selectAll")}
              </Button>
              <Button size="xs" variant="subtle" onClick={() => setAll(false)} disabled={!enabled}>
                {t("emailSettingsForm.types.clear")}
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {NOTIFICATION_TYPE_OPTIONS.map((o) => (
                <Checkbox
                  key={o.value}
                  id={`notify-${o.value}`}
                  name="notifyTypes"
                  value={o.value}
                  checked={types.has(o.value)}
                  onChange={() => toggleType(o.value)}
                  label={t(`notificationTypes.${o.value}.label`)}
                  description={t(`notificationTypes.${o.value}.description`)}
                />
              ))}
            </div>
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t("emailSettingsForm.sender.title")}>
        <SettingsRow
          label={t("emailSettingsForm.fromName.label")}
          description={
            senderAddress
              ? t("emailSettingsForm.fromName.descriptionWithAddress", { sender: `${fromName || "LearnLoop"} <${senderAddress}>` })
              : t("emailSettingsForm.fromName.description")
          }
          htmlFor="fromName"
          error={errors.fromName}
          required
        >
          <Input id="fromName" name="fromName" value={fromName} onChange={(e) => setFromName(e.target.value)} maxLength={80} invalid={!!errors.fromName} required />
        </SettingsRow>
        <SettingsRow label={t("emailSettingsForm.replyTo.label")} description={t("emailSettingsForm.replyTo.description")} htmlFor="replyTo" error={errors.replyTo}>
          <Input id="replyTo" name="replyTo" type="email" defaultValue={initial.replyTo ?? ""} placeholder="support@example.com" invalid={!!errors.replyTo} />
        </SettingsRow>
        <SettingsRow label={t("emailSettingsForm.footer.label")} description={t("emailSettingsForm.footer.description")} htmlFor="footerText" error={errors.footerText} stacked>
          <Textarea id="footerText" name="footerText" rows={3} maxLength={500} defaultValue={initial.footerText ?? ""} invalid={!!errors.footerText} />
        </SettingsRow>
      </SettingsSection>

      <SaveBar dirty={dirty} pending={pending} saved={state?.ok} failed={state?.ok === false} />
    </form>
  );
}
