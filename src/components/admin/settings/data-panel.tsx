"use client";

import { useState } from "react";
import { resetDemoDataAction } from "@/lib/actions/settings";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { Dialog } from "@/components/ui/dialog";
import { useFormAction } from "./use-form-action";

/**
 * Backup download + typed-confirmation "Reload demo data". `seedDemoData`
 * mirrors SEED_DEMO_DATA so the reset dialog can warn when the site was
 * started without demo content.
 */
export function DataPanel({ seedDemoData }: { seedDemoData: boolean }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const { onSubmit, pending, errors } = useFormAction(resetDemoDataAction, { toastSuccess: false });

  return (
    <div className="grid gap-5 md:grid-cols-2">
      <section className="flex flex-col rounded-card border border-border bg-surface-1 p-5 shadow-card">
        <span className="flex size-10 items-center justify-center rounded-lg bg-accent/10 text-accent">
          <Icon.Download className="size-5" />
        </span>
        <h3 className="mt-3 text-base font-semibold text-ink">Download backup</h3>
        <p className="mt-1 flex-1 text-sm text-ink-muted">
          A complete JSON snapshot of every record and setting. It includes password hashes and payment details, so store it somewhere safe.
        </p>
        <a href="/api/admin/backup" download className={buttonClasses({ variant: "outline", className: "mt-4 self-start" })}>
          <Icon.Download className="size-4" />
          Download backup
        </a>
      </section>

      <section className="flex flex-col rounded-card border border-danger/30 bg-surface-1 p-5 shadow-card">
        <span className="flex size-10 items-center justify-center rounded-lg bg-danger/10 text-danger">
          <Icon.Refresh className="size-5" />
        </span>
        <h3 className="mt-3 text-base font-semibold text-ink">Reload demo data</h3>
        <p className="mt-1 flex-1 text-sm text-ink-muted">
          Replaces everything — members, courses, progress, payments and settings — with the original demo content. Download a backup first if you want to keep your data.
        </p>
        {!seedDemoData && (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-ink">
            <Icon.AlertTriangle className="mt-px size-4 shrink-0 text-warning" />
            <span>
              This site was started with <code className="font-mono">SEED_DEMO_DATA=false</code>. Reloading replaces your content with the demo courses and members, and the admin account from
              your .env file will no longer exist.
            </span>
          </p>
        )}
        <Button variant="danger" className="mt-4 self-start" leftIcon={<Icon.Refresh className="size-4" />} onClick={() => setOpen(true)}>
          Reload demo data
        </Button>
      </section>

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
            This permanently deletes all current data and cannot be undone. Everyone will be signed out; demo accounts use the password <code className="rounded bg-surface-2 px-1">password123</code>.
          </p>
          <Field label={<>Type <span className="font-mono">RESET</span> to confirm</>} htmlFor="reset-confirm" error={errors.confirm}>
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
    </div>
  );
}
