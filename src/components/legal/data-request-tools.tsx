"use client";

import { useMemo, useState } from "react";
import { adminEraseAccountAction } from "@/lib/actions/privacy";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { PasswordField } from "@/components/security/password-field";
import { MemberPicker, type PickerMember } from "@/components/admin/settings/member-picker";
import { useFormAction } from "@/components/admin/settings/use-form-action";
import { DataExportForm } from "./data-export-form";

/**
 * Tools for personal-data requests received outside the app (by email or
 * letter): download a member's data, or erase their account. Both are
 * recorded as data requests and in the audit log.
 */
export function DataRequestTools({ members, viewerId }: { members: PickerMember[]; viewerId: string }) {
  const [exportMember, setExportMember] = useState("");
  const [eraseOpen, setEraseOpen] = useState(false);
  // Administrators delete their own account from their privacy settings, never from here.
  const erasable = useMemo(() => members.filter((m) => m.id !== viewerId), [members, viewerId]);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section aria-labelledby="export-member-title" className="rounded-lg border border-border p-4">
        <h3 id="export-member-title" className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Icon.Download className="size-4 text-ink-muted" />
          Download a member&apos;s data
        </h3>
        <p className="mt-1 mb-3 text-sm text-ink-muted">The same JSON file members get from their privacy settings. Send it to them over a secure channel.</p>
        <DataExportForm label="Download data" busyLabel="Preparing…" variant="outline" size="sm" disabled={!exportMember}>
          <Field label="Member" htmlFor="export-member">
            <MemberPicker id="export-member" name="userId" members={members} onChange={setExportMember} />
          </Field>
        </DataExportForm>
      </section>

      <section aria-labelledby="erase-member-title" className="rounded-lg border border-danger/30 p-4">
        <h3 id="erase-member-title" className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Icon.Trash className="size-4 text-danger" />
          Erase a member&apos;s account
        </h3>
        <p className="mt-1 mb-3 text-sm text-ink-muted">
          Removes their personal data exactly like &quot;Delete my account&quot;: orders keep amounts and invoice numbers, posts show &quot;Deleted user&quot;.
        </p>
        <Button variant="danger" size="sm" leftIcon={<Icon.Trash className="size-4" />} onClick={() => setEraseOpen(true)} disabled={!erasable.length}>
          Erase an account…
        </Button>
        {eraseOpen && <EraseAccountDialog members={erasable} onClose={() => setEraseOpen(false)} />}
      </section>
    </div>
  );
}

function EraseAccountDialog({ members, onClose }: { members: PickerMember[]; onClose: () => void }) {
  const [confirm, setConfirm] = useState("");
  const [memberId, setMemberId] = useState("");
  const { onSubmit, pending, errors, formError } = useFormAction(adminEraseAccountAction, { onSuccess: onClose });
  const member = members.find((m) => m.id === memberId);
  const formId = "erase-account-form";

  return (
    <Dialog
      open
      onClose={() => (pending ? undefined : onClose())}
      title="Erase a member's account?"
      description="This can't be undone. The member is signed out everywhere and can't sign in again."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="danger" loading={pending} disabled={!memberId || confirm.trim().toUpperCase() !== "DELETE"}>
            Erase account
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError message={formError && !Object.keys(errors).length ? formError : null} />
        <Field label="Member" htmlFor="erase-member" required error={errors.userId}>
          <MemberPicker id="erase-member" name="userId" members={members} invalid={!!errors.userId} onChange={setMemberId} />
        </Field>
        {member && (
          <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-ink">
            <span className="font-medium">{member.name}</span> ({member.email}) will be replaced by &quot;Deleted user&quot;.
          </p>
        )}
        <Field label="Your password" htmlFor="erase-password" required error={errors.password} hint="Confirms that you are making this change.">
          <PasswordField id="erase-password" name="password" autoComplete="current-password" required invalid={!!errors.password} />
        </Field>
        <Field label={<>Type <span className="font-mono font-semibold">DELETE</span> to confirm</>} htmlFor="erase-confirm" required error={errors.confirm}>
          <Input
            id="erase-confirm"
            name="confirm"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            invalid={!!errors.confirm}
          />
        </Field>
      </form>
    </Dialog>
  );
}
