"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { createPortal } from "react-dom";
import type { PublicUser, Role } from "@/lib/types";
import { createMemberInlineAction } from "@/lib/actions/members";
import { ROLE_OPTIONS } from "@/components/admin/settings/roles";
import { Button, IconButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input, Switch } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";

/** Value of the "Add New Member" entry in native evaluator selects. */
export const CREATE_MEMBER_OPTION = "__create_member__";

/** What the new member is being added as; decides the default role and which roles qualify. */
export type MemberPurpose = "instructor" | "evaluator";

const PURPOSES: Record<MemberPurpose, { defaultRole: Role; qualifying: Role[]; roleHint: string }> = {
  instructor: {
    defaultRole: "course_creator",
    qualifying: ["course_creator", "moderator", "admin"],
    roleHint: "Instructors need the Course Creator or Moderator role.",
  },
  evaluator: {
    defaultRole: "batch_evaluator",
    qualifying: ["batch_evaluator", "moderator", "admin"],
    roleHint: "Evaluators need the Evaluator or Moderator role.",
  },
};

export function memberQualifies(user: Pick<PublicUser, "roles">, purpose: MemberPurpose): boolean {
  return user.roles.some((r) => PURPOSES[purpose].qualifying.includes(r));
}

const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** A 14-character password with at least one letter and one digit. */
function generatePassword(): string {
  const bytes = new Uint32Array(14);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (n) => ALPHABET[n % ALPHABET.length]);
  if (!chars.some((c) => /[0-9]/.test(c))) chars[bytes[0] % chars.length] = String(2 + (bytes[1] % 8));
  if (!chars.some((c) => /[a-zA-Z]/.test(c))) chars[bytes[2] % chars.length] = "k";
  return chars.join("");
}

/** Split a picker search into a sensible email or name prefill. */
function prefillFrom(query: string): { email: string; firstName: string; lastName: string } {
  const q = query.trim();
  if (q.includes("@")) return { email: q.toLowerCase(), firstName: "", lastName: "" };
  const [first = "", ...rest] = q.split(/\s+/);
  return { email: "", firstName: first, lastName: rest.join(" ") };
}

export interface CreateMemberDialogProps {
  open: boolean;
  onClose: () => void;
  purpose: MemberPurpose;
  /** Admins may also grant the admin role. */
  canGrantAdmin: boolean;
  /** Text typed in the picker, used to prefill the form. */
  initialQuery?: string;
  onCreated: (user: PublicUser) => void;
}

/**
 * "Add New Member" modal opened from the instructor/evaluator pickers. It is
 * rendered into document.body so its form never nests inside the course form.
 */
export function CreateMemberDialog(props: CreateMemberDialogProps) {
  if (!props.open || typeof document === "undefined") return null;
  // Remount per opening so the fields start from the latest prefill.
  return createPortal(<CreateMemberDialogBody {...props} />, document.body);
}

function CreateMemberDialogBody({ onClose, purpose, canGrantAdmin, initialQuery = "", onCreated }: CreateMemberDialogProps) {
  const toast = useToast();
  const formId = useId();
  const config = PURPOSES[purpose];
  const [prefill] = useState(() => prefillFrom(initialQuery));
  const [email, setEmail] = useState(prefill.email);
  const [firstName, setFirstName] = useState(prefill.firstName);
  const [lastName, setLastName] = useState(prefill.lastName);
  const [password, setPassword] = useState(() => generatePassword());
  const [showPassword, setShowPassword] = useState(true);
  const [roles, setRoles] = useState<Role[]>([config.defaultRole]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const roleOptions = ROLE_OPTIONS.filter((r) => !r.adminOnly || canGrantAdmin);
  const toggleRole = (role: Role, on: boolean) => setRoles((list) => (on ? (list.includes(role) ? list : [...list, role]) : list.filter((r) => r !== role)));

  const copyPassword = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy the password", "Select it and copy it manually.");
    }
  };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // The dialog is portalled, but React still bubbles events to the course form.
    e.stopPropagation();
    if (pending) return;

    const name = `${firstName.trim()} ${lastName.trim()}`.trim();
    const local: Record<string, string> = {};
    if (!email.trim()) local.email = "Email is required";
    if (!firstName.trim()) local.firstName = "First name is required";
    else if (name.length < 2) local.firstName = "Please enter the member's full name.";
    if (!roles.some((r) => config.qualifying.includes(r))) local.roles = config.roleHint;
    if (Object.keys(local).length) {
      setErrors(local);
      setFormError(null);
      return;
    }

    const formData = new FormData();
    formData.set("name", name);
    formData.set("email", email.trim());
    formData.set("password", password);
    for (const r of roles) formData.append("roles", r);

    startTransition(async () => {
      const result = await createMemberInlineAction(null, formData);
      if (!result.ok) {
        const fieldErrors = { ...(result.fieldErrors ?? {}) };
        if (fieldErrors.name) {
          fieldErrors.firstName = fieldErrors.name;
          delete fieldErrors.name;
        }
        setErrors(fieldErrors);
        setFormError(result.fieldErrors && Object.keys(result.fieldErrors).length ? null : result.error);
        return;
      }
      toast.success(result.message ?? "Member added successfully", "Share the password with them so they can sign in.");
      onCreated(result.data);
      onClose();
    });
  };

  return (
    <Dialog
      open
      onClose={() => {
        if (!pending) onClose();
      }}
      title="Add New Member"
      description={purpose === "instructor" ? "Create an account and add it to this course's instructors." : "Create an account and make it this course's evaluator."}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={pending} leftIcon={<Icon.UserPlus className="size-4" />}>
            Add member
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-4" noValidate>
        <FormError message={formError} />
        <Field label="Email" htmlFor={`${formId}-email`} required error={errors.email}>
          <Input
            id={`${formId}-email`}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="off"
            placeholder="jane@example.com"
            invalid={!!errors.email}
            autoFocus={!prefill.email}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" htmlFor={`${formId}-first`} required error={errors.firstName}>
            <Input id={`${formId}-first`} value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="off" maxLength={60} invalid={!!errors.firstName} />
          </Field>
          <Field label="Last name" htmlFor={`${formId}-last`}>
            <Input id={`${formId}-last`} value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="off" maxLength={60} />
          </Field>
        </div>
        <Field label="Password" htmlFor={`${formId}-password`} required error={errors.password} hint="Share it with the new member; they can change it from their settings.">
          <div className="flex gap-2">
            <Input
              id={`${formId}-password`}
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              className="font-mono"
              invalid={!!errors.password}
            />
            <IconButton label={showPassword ? "Hide password" : "Show password"} variant="outline" onClick={() => setShowPassword((s) => !s)}>
              {showPassword ? <Icon.EyeOff className="size-4" /> : <Icon.Eye className="size-4" />}
            </IconButton>
            <IconButton label={copied ? "Copied" : "Copy password"} variant="outline" onClick={copyPassword}>
              {copied ? <Icon.Check className="size-4 text-success" /> : <Icon.Copy className="size-4" />}
            </IconButton>
            <IconButton label="Generate a new password" variant="outline" onClick={() => setPassword(generatePassword())}>
              <Icon.Refresh className="size-4" />
            </IconButton>
          </div>
        </Field>
        <fieldset className="space-y-3">
          <legend className="mb-2 text-sm font-medium text-ink">Roles</legend>
          {roleOptions.map((r) => (
            <Switch
              key={r.value}
              id={`${formId}-role-${r.value}`}
              checked={roles.includes(r.value)}
              onChange={(e) => toggleRole(r.value, e.target.checked)}
              label={r.label}
              description={r.description}
            />
          ))}
          {errors.roles && <p className="text-xs text-danger">{errors.roles}</p>}
        </fieldset>
      </form>
    </Dialog>
  );
}
