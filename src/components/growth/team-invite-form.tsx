"use client";

import { useId, useMemo, useRef, useState, useTransition, type ChangeEvent } from "react";
import { claimSeatAction, inviteMembersAction } from "@/lib/actions/teams";
import { MAX_INVITES_PER_REQUEST, parseInviteList } from "@/lib/growth/teams-shared";
import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { FormError, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useFormAction } from "@/components/admin/settings/use-form-action";
import { pluralize } from "@/lib/utils";

const MAX_FILE_BYTES = 256 * 1024;

/**
 * Invite team members by email: paste addresses (one per line, or
 * `email, name` rows) or load a CSV file. The list is checked as you type;
 * the server decides who is actually invited.
 */
export function TeamInviteForm({ orgId, available, buyHref }: { orgId: string; available: number; buyHref: string }) {
  const id = useId();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const { onSubmit, pending, errors, formError } = useFormAction(inviteMembersAction, { onSuccess: () => setText("") });
  const parsed = useMemo(() => parseInviteList(text), [text]);
  const count = parsed.entries.length;
  const overflow = Math.max(0, count - available);

  const loadFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      toast.error("This file is too large. Use a CSV file under 256 KB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const content = typeof reader.result === "string" ? reader.result : "";
      setText((prev) => (prev.trim() ? `${prev.trim()}\n${content}` : content));
    };
    reader.onerror = () => toast.error("This file could not be read.");
    reader.readAsText(file);
  };

  if (available <= 0) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border-strong px-4 py-5 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="text-ink-muted">Every seat is assigned. Buy more seats, or revoke a seat to give it to someone else.</p>
        <ButtonLink href={buyHref} size="sm" leftIcon={<Icon.Plus className="size-4" />}>
          Buy more seats
        </ButtonLink>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-3">
      <input type="hidden" name="orgId" value={orgId} />
      <div>
        <label htmlFor={`${id}-emails`} className="mb-1.5 block text-sm font-medium text-ink">
          Email addresses
        </label>
        <Textarea
          id={`${id}-emails`}
          name="emails"
          rows={5}
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          placeholder={"ada@example.com\nGrace Hopper <grace@example.com>\nlinus@example.com, Linus Torvalds"}
          invalid={!!errors.emails}
          aria-describedby={`${id}-hint`}
          spellCheck={false}
          autoCapitalize="off"
          className="font-mono text-[13px]"
        />
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-ink-muted" aria-live="polite">
          {count === 0
            ? `One address per line, or paste a CSV with email and name columns. Up to ${MAX_INVITES_PER_REQUEST} at a time.`
            : `${pluralize(count, "address", "addresses")} ready${parsed.duplicates ? ` · ${pluralize(parsed.duplicates, "duplicate")} ignored` : ""}${
                parsed.invalid.length ? ` · ${pluralize(parsed.invalid.length, "row")} without a valid address` : ""
              }${parsed.truncated ? ` · only the first ${MAX_INVITES_PER_REQUEST} are used` : ""}`}
        </p>
        {overflow > 0 && (
          <p className="mt-1 text-xs text-warning" role="status">
            Only {pluralize(available, "seat")} {available === 1 ? "is" : "are"} free: the last {pluralize(overflow, "address", "addresses")} won&apos;t be invited.
          </p>
        )}
        {parsed.invalid.length > 0 && (
          <p className="mt-1 truncate text-xs text-danger" title={parsed.invalid.join("\n")}>
            Not an email address: {parsed.invalid.slice(0, 3).join(", ")}
            {parsed.invalid.length > 3 ? "…" : ""}
          </p>
        )}
      </div>
      <FormError message={formError} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" loading={pending} disabled={count === 0} leftIcon={<Icon.Send className="size-4" />}>
          {count > 1 ? `Send ${Math.min(count, available)} invitations` : "Send invitation"}
        </Button>
        <input ref={fileRef} type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={loadFile} />
        <Button variant="outline" onClick={() => fileRef.current?.click()} leftIcon={<Icon.Upload className="size-4" />}>
          Load a CSV file
        </Button>
      </div>
    </form>
  );
}

/** Lets a manager take one of the team's free seats for themselves. */
export function ClaimSeatButton({ orgId }: { orgId: string }) {
  const toast = useToast();
  const [busy, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      loading={busy}
      leftIcon={<Icon.UserPlus className="size-4" />}
      onClick={() =>
        startTransition(async () => {
          const result = await claimSeatAction(orgId);
          if (result.ok) toast.success(result.message ?? "Seat assigned");
          else toast.error(result.error);
        })
      }
    >
      Take a seat myself
    </Button>
  );
}
