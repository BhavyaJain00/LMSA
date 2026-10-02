"use client";

import { useState } from "react";
import { reloadDemoDataAction } from "@/app/(app)/admin/settings/data/actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { Dialog } from "@/components/ui/dialog";
import { useFormAction } from "./use-form-action";
import { useT } from "@/i18n/client";

/**
 * Typed-confirmation "Reload demo data". `seedDemoData` mirrors
 * SEED_DEMO_DATA so the card can warn when the site was started without
 * demo content. The current data is saved as a safety backup first.
 */
export function DataPanel({ seedDemoData }: { seedDemoData: boolean }) {
  const t = useT("admin");
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const { onSubmit, pending, errors } = useFormAction(reloadDemoDataAction, { toastSuccess: false });

  return (
    <section className="rounded-card border border-danger/30 bg-surface-1 p-4 shadow-card sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-start gap-4 sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-danger/10 text-danger">
            <Icon.Refresh className="size-5" />
          </span>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-ink">{t("dataPanel.title")}</h3>
            <p className="mt-1 text-sm text-ink-muted">
              {t("dataPanel.description")}
            </p>
          </div>
        </div>
        <Button variant="danger" className="shrink-0 self-start" leftIcon={<Icon.Refresh className="size-4" />} onClick={() => setOpen(true)}>
          {t("dataPanel.title")}
        </Button>
      </div>
      {!seedDemoData && (
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-ink">
          <Icon.AlertTriangle className="mt-px size-4 shrink-0 text-warning" />
          <span>
            {t.rich("dataPanel.noSeedWarning", { code: (chunks) => <code className="font-mono" dir="ltr">{chunks}</code> })}
          </span>
        </p>
      )}

      <Dialog
        open={open}
        onClose={() => (pending ? undefined : setOpen(false))}
        size="sm"
        title={t("dataPanel.confirmTitle")}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              {t("shared.cancel")}
            </Button>
            <Button type="submit" form="reset-demo-form" variant="danger" loading={pending} disabled={confirm !== "RESET"}>
              {t("dataPanel.title")}
            </Button>
          </>
        }
      >
        <form id="reset-demo-form" onSubmit={onSubmit} noValidate className="space-y-3">
          <p className="text-sm text-ink-muted">
            {t.rich("dataPanel.confirmDescription", { code: (chunks) => <code className="rounded bg-surface-2 px-1" dir="ltr">{chunks}</code> })}
          </p>
          <Field
            label={t.rich("dataPanel.typeToConfirm", { word: <span className="font-mono">RESET</span> })}
            htmlFor="reset-confirm"
            error={errors.confirm}
          >
            <Input
              id="reset-confirm"
              name="confirm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
              invalid={!!errors.confirm}
            />
          </Field>
        </form>
      </Dialog>
    </section>
  );
}
