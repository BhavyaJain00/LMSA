"use client";

import { useActionState, useState, useTransition } from "react";
import type { ActionResult, EmailPreferences } from "@/lib/types";
import { saveEmailPreferencesAction, setAllEmailPreferencesAction } from "@/lib/actions/email-preferences";
import { EMAIL_PREFERENCE_OPTIONS } from "@/lib/email/preferences";
import { Button } from "@/components/ui/button";
import { FormError, Switch } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/i18n/client";

/** Per-category email toggles for the signed-in member. */
export function EmailPreferencesForm({ initial }: { initial: EmailPreferences }) {
  const toast = useToast();
  const t = useT("account");
  const [values, setValues] = useState<EmailPreferences>(initial);
  const [saved, setSaved] = useState<EmailPreferences>(initial);
  const [bulkPending, startBulk] = useTransition();
  const [state, action, pending] = useActionState<ActionResult<EmailPreferences> | null, FormData>(async (prev, formData) => {
    const result = await saveEmailPreferencesAction(prev, formData);
    if (result.ok) {
      setSaved(result.data);
      setValues(result.data);
      toast.success(result.message ?? t("settings.notifications.saved"));
    } else {
      toast.error(t("settings.notifications.saveFailed"), result.error);
    }
    return result;
  }, null);

  const dirty = EMAIL_PREFERENCE_OPTIONS.some((o) => values[o.key] !== saved[o.key]);
  const allOn = EMAIL_PREFERENCE_OPTIONS.every((o) => values[o.key]);
  const allOff = EMAIL_PREFERENCE_OPTIONS.every((o) => !values[o.key]);

  const setAll = (on: boolean) =>
    startBulk(async () => {
      const result = await setAllEmailPreferencesAction(on);
      if (result.ok) {
        setSaved(result.data);
        setValues(result.data);
        toast.success(result.message ?? t("settings.notifications.bulkSaved"));
      } else {
        toast.error(t("settings.notifications.updateFailed"), result.error);
      }
    });

  return (
    <form action={action} className="space-y-1">
      <FormError message={state && !state.ok ? state.error : null} />
      <div className="divide-y divide-border">
        {EMAIL_PREFERENCE_OPTIONS.map((o) => (
          <div key={o.key} className="py-3.5 first:pt-0">
            <Switch
              id={`pref-${o.key}`}
              name={o.key}
              checked={values[o.key]}
              onChange={(e) => setValues((v) => ({ ...v, [o.key]: e.target.checked }))}
              label={t(`settings.notifications.pref.${o.key}`)}
              description={t(`settings.notifications.pref.${o.key}.description`)}
            />
          </div>
        ))}
      </div>
      <div className="flex flex-col-reverse gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" onClick={() => setAll(false)} disabled={allOff || bulkPending || pending}>
            {t("settings.notifications.unsubscribeAll")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setAll(true)} disabled={allOn || bulkPending || pending}>
            {t("settings.notifications.subscribeAll")}
          </Button>
        </div>
        <Button type="submit" loading={pending} disabled={!dirty || bulkPending}>
          {t("settings.notifications.save")}
        </Button>
      </div>
    </form>
  );
}
