"use client";

import { useState } from "react";
import { reloadDemoDataAction } from "@/app/(app)/admin/settings/data/actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { Dialog } from "@/components/ui/dialog";
import { useFormAction } from "./use-form-action";

/**
 * Typed-confirmation "Reload demo data". `seedDemoData` mirrors
 * SEED_DEMO_DATA so the card can warn when the site was started without
 * demo content. The current data is saved as a safety backup first.
 */
export function DataPanel({ seedDemoData }: { seedDemoData: boolean }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const { onSubmit, pending, errors } = useFormAction(reloadDemoDataAction, { toastSuccess: false });

  return (
    <section className="rounded-card border border-danger/30 bg-surface-1 p-4 shadow-card sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-danger/10 text-danger">
            <Icon.Refresh className="size-5" />
          </span>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-ink">Reload demo data</h3>
            <p className="mt-1 text-sm text-ink-muted">
              Replaces everything (members, courses, progress, payments and settings) with the original demo content. The data as it is now is saved as a safety backup first, so you can
              restore it from the list above.
            </p>
          </div>
        </div>
        <Button variant="danger" className="shrink-0 self-start" leftIcon={<Icon.Refresh className="size-4" />} onClick={() => setOpen(true)}>
          Reload demo data
        </Button>
      </div>
      {!seedDemoData && (
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-ink">
          <Icon.AlertTriangle className="mt-px size-4 shrink-0 text-warning" />
          <span>
            This site was started with <code className="font-mono">SEED_DEMO_DATA=false</code>. Reloading replaces your content with the demo courses and members, and the admin account from your
            .env file will no longer exist.
          </span>
        </p>
      )}

      <Dialog
        open={open}
        onClose={() => (pending ? undefined : setOpen(false))}
        size="sm"
        title="Reload demo data?"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form="reset-demo-form" variant="danger" loading={pending} disabled={confirm !== "RESET"}>
              Reload demo data
            </Button>
          </>
        }
      >
        <form id="reset-demo-form" onSubmit={onSubmit} noValidate className="space-y-3">
          <p className="text-sm text-ink-muted">
            All current data is replaced by the demo content and everyone is signed out. Demo accounts use the password <code className="rounded bg-surface-2 px-1">password123</code>. A safety
            backup of the current data is kept on the server.
          </p>
          <Field
            label={
              <>
                Type <span className="font-mono">RESET</span> to confirm
              </>
            }
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
