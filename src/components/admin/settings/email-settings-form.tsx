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

export type EmailSettingsValues = Settings["email"];

/** Settings → Email: master switch, sender identity, footer and which notifications are emailed. */
export function EmailSettingsForm({ initial, senderAddress }: { initial: EmailSettingsValues; senderAddress: string | null }) {
  const { onSubmit, pending, errors, dirty, markDirty, state } = useFormAction(saveEmailSettingsAction);
  const [types, setTypes] = useState<Set<NotificationType>>(new Set(initial.notifyTypes));
  const [enabled, setEnabled] = useState(initial.enabled);
  const [fromName, setFromName] = useState(initial.fromName);

  const toggleType = (t: NotificationType) => {
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
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
      <SettingsSection title="Notification emails">
        <SettingsSwitchRow>
          <Switch
            name="enabled"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            label="Send email notifications"
            description="Email copies of notifications, announcements, batch messages and receipts. Password reset and verification emails are always sent."
          />
        </SettingsSwitchRow>
        <SettingsRow
          label="Emailed notification types"
          description="Members only receive the types checked here, and can turn categories off in their own email preferences."
          error={errors.notifyTypes}
          stacked
        >
          <div className={enabled ? "" : "pointer-events-none opacity-60"} aria-disabled={!enabled}>
            <div className="mb-3 flex gap-2">
              <Button size="xs" variant="subtle" onClick={() => setAll(true)} disabled={!enabled}>
                Select all
              </Button>
              <Button size="xs" variant="subtle" onClick={() => setAll(false)} disabled={!enabled}>
                Clear
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
                  label={o.label}
                  description={o.description}
                />
              ))}
            </div>
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Sender">
        <SettingsRow
          label="From name"
          description={senderAddress ? `Shown as the sender, e.g. “${fromName || "LearnLoop"} <${senderAddress}>”. The address comes from MAIL_FROM.` : "Shown as the sender name. The address comes from MAIL_FROM."}
          htmlFor="fromName"
          error={errors.fromName}
          required
        >
          <Input id="fromName" name="fromName" value={fromName} onChange={(e) => setFromName(e.target.value)} maxLength={80} invalid={!!errors.fromName} required />
        </SettingsRow>
        <SettingsRow label="Reply-to address" description="Where replies go. Leave empty to use the sender address." htmlFor="replyTo" error={errors.replyTo}>
          <Input id="replyTo" name="replyTo" type="email" defaultValue={initial.replyTo ?? ""} placeholder="support@example.com" invalid={!!errors.replyTo} />
        </SettingsRow>
        <SettingsRow label="Footer text" description="Printed at the bottom of every email, e.g. your postal address or why members receive emails." htmlFor="footerText" error={errors.footerText} stacked>
          <Textarea id="footerText" name="footerText" rows={3} maxLength={500} defaultValue={initial.footerText ?? ""} invalid={!!errors.footerText} />
        </SettingsRow>
      </SettingsSection>

      <SaveBar dirty={dirty} pending={pending} saved={state?.ok} failed={state?.ok === false} />
    </form>
  );
}
