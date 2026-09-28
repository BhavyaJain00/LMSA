"use client";

import { useState, useTransition } from "react";
import type { Role } from "@/lib/types";
import {
  createMemberAction,
  deleteMemberAction,
  resetMemberPasswordAction,
  setMemberEnabledAction,
  updateMemberProfileAction,
  updateMemberRolesAction,
} from "@/lib/actions/members";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, FormError, Input, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { RoleSwitches } from "./role-switches";
import { SaveBar } from "./save-bar";
import { useFormAction } from "./use-form-action";

function generatePassword(): string {
  const letters = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const all = letters + digits;
  const bytes = new Uint8Array(14);
  crypto.getRandomValues(bytes);
  let out = "";
  bytes.forEach((b, i) => {
    const pool = i === 0 ? letters : i === 1 ? digits : all;
    out += pool[b % pool.length];
  });
  return out;
}

function PasswordInput({ id, name, value, onChange, invalid, autoComplete = "new-password" }: { id: string; name: string; value: string; onChange: (v: string) => void; invalid?: boolean; autoComplete?: string }) {
  const [show, setShow] = useState(false);
  return (
    <Input
      id={id}
      name={name}
      type={show ? "text" : "password"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoComplete={autoComplete}
      invalid={invalid}
      leftAddon={<Icon.Lock className="size-4" />}
      rightAddon={
        <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"} className="pointer-events-auto text-ink-faint hover:text-ink">
          {show ? <Icon.EyeOff className="size-4" /> : <Icon.Eye className="size-4" />}
        </button>
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

export function CreateMemberForm({ canGrantAdmin }: { canGrantAdmin: boolean }) {
  const [password, setPassword] = useState("");
  const { onSubmit, pending, errors, formError } = useFormAction(createMemberAction, { toastError: false });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      <FormError message={formError} />
      <div className="rounded-card border border-border bg-surface-1 p-5 shadow-card">
        <h2 className="text-base font-semibold text-ink">Account</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Full name" htmlFor="member-name" error={errors.name} required>
            <Input id="member-name" name="name" placeholder="Ada Lovelace" maxLength={100} invalid={!!errors.name} autoFocus />
          </Field>
          <Field label="Email" htmlFor="member-email" error={errors.email} required>
            <Input id="member-email" name="email" type="email" placeholder="ada@example.com" invalid={!!errors.email} leftAddon={<Icon.Mail className="size-4" />} />
          </Field>
          <Field label="Username" htmlFor="member-username" error={errors.username} hint={errors.username ? undefined : "Optional — derived from the email when empty."}>
            <Input id="member-username" name="username" placeholder="ada" maxLength={40} invalid={!!errors.username} leftAddon={<span className="text-xs">@</span>} />
          </Field>
          <Field label="Password" htmlFor="member-password" error={errors.password} hint={errors.password ? undefined : "At least 8 characters with letters and numbers."} required>
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <PasswordInput id="member-password" name="password" value={password} onChange={setPassword} invalid={!!errors.password} />
              </div>
              <Button type="button" variant="outline" onClick={() => setPassword(generatePassword())} title="Generate a strong password">
                Generate
              </Button>
            </div>
          </Field>
        </div>
        <p className="mt-3 text-xs text-ink-muted">Share the password with the member securely. They can change it from their profile after signing in.</p>
      </div>

      <div className="rounded-card border border-border bg-surface-1 p-5 shadow-card">
        <h2 className="text-base font-semibold text-ink">Roles</h2>
        <p className="mt-0.5 text-sm text-ink-muted">Members without a role are added as students.</p>
        <RoleSwitches defaultRoles={["student"]} canGrantAdmin={canGrantAdmin} className="mt-4" idPrefix="new-role" />
        {errors.roles && <p className="mt-2 text-xs text-danger">{errors.roles}</p>}
      </div>

      <div className="flex justify-end gap-2">
        <Button type="submit" loading={pending} leftIcon={<Icon.UserPlus className="size-4" />}>
          Add member
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Edit: profile                                                       */
/* ------------------------------------------------------------------ */

export interface MemberProfileValues {
  id: string;
  name: string;
  email: string;
  username: string;
  headline: string;
  location: string;
  bio: string;
}

export function MemberProfileForm({ member, canEditEmail, readOnly }: { member: MemberProfileValues; canEditEmail: boolean; readOnly: boolean }) {
  const { onSubmit, pending, errors, dirty, markDirty, state } = useFormAction(updateMemberProfileAction);
  return (
    <form onSubmit={onSubmit} onChange={markDirty} noValidate className="rounded-card border border-border bg-surface-1 p-5 shadow-card">
      <input type="hidden" name="id" value={member.id} />
      <h2 className="text-base font-semibold text-ink">Profile</h2>
      <fieldset disabled={readOnly} className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Full name" htmlFor="profile-name" error={errors.name} required>
          <Input id="profile-name" name="name" defaultValue={member.name} maxLength={100} invalid={!!errors.name} />
        </Field>
        <Field label="Email" htmlFor="profile-email" error={errors.email} hint={canEditEmail ? undefined : "Only administrators can change email addresses."}>
          <Input id="profile-email" name="email" type="email" defaultValue={member.email} disabled={!canEditEmail} invalid={!!errors.email} />
        </Field>
        <Field label="Username" htmlFor="profile-username" error={errors.username} required>
          <Input id="profile-username" name="username" defaultValue={member.username} maxLength={40} invalid={!!errors.username} leftAddon={<span className="text-xs">@</span>} />
        </Field>
        <Field label="Location" htmlFor="profile-location" error={errors.location}>
          <Input id="profile-location" name="location" defaultValue={member.location} maxLength={80} placeholder="London" invalid={!!errors.location} />
        </Field>
        <Field label="Headline" htmlFor="profile-headline" error={errors.headline} className="sm:col-span-2">
          <Input id="profile-headline" name="headline" defaultValue={member.headline} maxLength={120} placeholder="Frontend developer" invalid={!!errors.headline} />
        </Field>
        <Field label="Bio" htmlFor="profile-bio" error={errors.bio} className="sm:col-span-2">
          <Textarea id="profile-bio" name="bio" rows={3} defaultValue={member.bio} maxLength={2000} placeholder="A line or two about this person" invalid={!!errors.bio} />
        </Field>
      </fieldset>
      {!readOnly && <SaveBar dirty={dirty} pending={pending} saved={state?.ok} className="mx-0 mt-5 shadow-none" />}
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Edit: roles                                                         */
/* ------------------------------------------------------------------ */

export function MemberRolesForm({ memberId, roles, canGrantAdmin, readOnly, lockedRoles }: { memberId: string; roles: Role[]; canGrantAdmin: boolean; readOnly: boolean; lockedRoles: Role[] }) {
  const { onSubmit, pending, dirty, markDirty, state } = useFormAction(updateMemberRolesAction);
  return (
    <form onSubmit={onSubmit} onChange={markDirty} noValidate className="rounded-card border border-border bg-surface-1 p-5 shadow-card">
      <input type="hidden" name="id" value={memberId} />
      <h2 className="text-base font-semibold text-ink">Roles</h2>
      <p className="mt-0.5 text-sm text-ink-muted">
        {readOnly ? "Only administrators can change an administrator's roles." : "Roles decide what this member can see and manage."}
      </p>
      <RoleSwitches defaultRoles={roles} canGrantAdmin={canGrantAdmin} disabled={readOnly} lockedRoles={lockedRoles} className="mt-4" idPrefix={`role-${memberId}`} />
      {!readOnly && <SaveBar dirty={dirty} pending={pending} saved={state?.ok} className="mx-0 mt-5 shadow-none" />}
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Edit: account (admin only)                                          */
/* ------------------------------------------------------------------ */

export function MemberAccountPanel({ member, isSelf }: { member: { id: string; name: string; enabled: boolean }; isSelf: boolean }) {
  const toast = useToast();
  const [confirm, setConfirm] = useState<"toggle" | "delete" | null>(null);
  const [busy, startTransition] = useTransition();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const reset = useFormAction(resetMemberPasswordAction, {
    onSuccess: () => {
      setPassword("");
      setConfirmPassword("");
    },
  });

  const toggleEnabled = () => {
    startTransition(async () => {
      const res = await setMemberEnabledAction(member.id, !member.enabled);
      if (res.ok) {
        toast.success(res.message ?? "Member updated");
        setConfirm(null);
      } else toast.error(res.error);
    });
  };

  const remove = () => {
    startTransition(async () => {
      const res = await deleteMemberAction(member.id);
      // On success the action redirects to the members list.
      if (res && !res.ok) {
        toast.error("Unable to delete user", res.error);
        setConfirm(null);
      }
    });
  };

  return (
    <div className="space-y-5">
      <section className="rounded-card border border-border bg-surface-1 p-5 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
              Sign-in access
              {member.enabled ? (
                <Badge tone="success" dot>
                  Enabled
                </Badge>
              ) : (
                <Badge tone="danger" dot>
                  Disabled
                </Badge>
              )}
            </h2>
            <p className="mt-0.5 text-sm text-ink-muted">
              {member.enabled ? "Disabling signs the member out everywhere and blocks new sign-ins. Their data is kept." : "This member cannot sign in until you enable the account again."}
            </p>
          </div>
          <Button variant={member.enabled ? "outline" : "primary"} onClick={() => setConfirm("toggle")} disabled={isSelf || busy}>
            {member.enabled ? "Disable account" : "Enable account"}
          </Button>
        </div>
        {isSelf && <p className="mt-2 text-xs text-ink-muted">You cannot disable your own account.</p>}
      </section>

      <form onSubmit={reset.onSubmit} noValidate className="rounded-card border border-border bg-surface-1 p-5 shadow-card">
        <input type="hidden" name="id" value={member.id} />
        <h2 className="text-base font-semibold text-ink">Reset password</h2>
        <p className="mt-0.5 text-sm text-ink-muted">Set a new password and share it with the member securely.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="New password" htmlFor={`reset-${member.id}`} error={reset.errors.password} required>
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <PasswordInput id={`reset-${member.id}`} name="password" value={password} onChange={setPassword} invalid={!!reset.errors.password} />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const p = generatePassword();
                  setPassword(p);
                  setConfirmPassword(p);
                }}
              >
                Generate
              </Button>
            </div>
          </Field>
          <Field label="Confirm password" htmlFor={`reset-confirm-${member.id}`} error={reset.errors.confirm} required>
            <PasswordInput id={`reset-confirm-${member.id}`} name="confirm" value={confirmPassword} onChange={setConfirmPassword} invalid={!!reset.errors.confirm} />
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          {!isSelf ? <Checkbox name="signOut" id={`signout-${member.id}`} defaultChecked label="Sign the member out of all devices" /> : <span />}
          <Button type="submit" variant="outline" loading={reset.pending} disabled={!password}>
            Update password
          </Button>
        </div>
      </form>

      <section className="rounded-card border border-danger/30 bg-surface-1 p-5 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-ink">Delete member</h2>
            <p className="mt-0.5 max-w-xl text-sm text-ink-muted">
              Permanently removes the account with its enrollments, progress, submissions and badges. Payment records are kept for accounting. Members who own courses or other content must be
              disabled instead.
            </p>
          </div>
          <Button variant="danger" onClick={() => setConfirm("delete")} disabled={isSelf || busy} leftIcon={<Icon.Trash className="size-4" />}>
            Delete user
          </Button>
        </div>
      </section>

      <ConfirmDialog
        open={confirm === "toggle"}
        onClose={() => (busy ? undefined : setConfirm(null))}
        onConfirm={toggleEnabled}
        loading={busy}
        destructive={member.enabled}
        title={member.enabled ? `Disable ${member.name}?` : `Enable ${member.name}?`}
        description={member.enabled ? "They will be signed out immediately and won't be able to sign in until you enable the account again." : "They will be able to sign in again with their existing password."}
        confirmLabel={member.enabled ? "Disable" : "Enable"}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onClose={() => (busy ? undefined : setConfirm(null))}
        onConfirm={remove}
        loading={busy}
        destructive
        title={`Delete ${member.name}?`}
        description="This permanently deletes the user account and cannot be undone."
        confirmLabel="Delete"
      />
    </div>
  );
}
