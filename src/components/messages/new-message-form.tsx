"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon, Spinner } from "@/components/ui/icons";
import { Field, FormError, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { searchRecipientsAction, startConversationAction } from "@/lib/actions/messages";
import { MESSAGE_LIMITS } from "@/lib/comms/messages-core";
import type { RecipientOption } from "@/lib/comms/messages";
import { announceInboxChange } from "./conversation-list";
import { MessageComposer } from "./message-composer";

function RecipientCard({ r, onClear }: { r: RecipientOption; onClear?: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-card border border-border bg-surface-2/60 p-3">
      <Avatar name={r.name} src={r.avatarUrl} size="md" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          <span className="truncate">{r.name}</span>
          {r.role && (
            <Badge tone="accent" size="xs">
              {r.role}
            </Badge>
          )}
        </p>
        <p className="truncate text-xs text-ink-muted">{r.courseTitle ? `About ${r.courseTitle}` : (r.headline ?? `@${r.username}`)}</p>
      </div>
      {onClear && (
        <Button variant="ghost" size="sm" onClick={onClear}>
          Change
        </Button>
      )}
    </div>
  );
}

/**
 * Start a conversation: pick a recipient (instructors of your courses are
 * suggested; type to search everyone you may message), then write the first
 * message. Picking someone you already talk to opens that conversation.
 */
export function NewMessageForm({ initialRecipient, suggestions, staff }: { initialRecipient: RecipientOption | null; suggestions: RecipientOption[]; staff: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [recipient, setRecipient] = useState<RecipientOption | null>(initialRecipient);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<RecipientOption[]>(suggestions);
  const [active, setActive] = useState(0);
  const [subject, setSubject] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestQuery = useRef("");
  const listId = useId();

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const choose = (r: RecipientOption) => {
    if (r.conversationId) {
      router.push(`/messages/${r.conversationId}`);
      return;
    }
    setRecipient(r);
    setError(null);
  };

  const onSearch = (value: string) => {
    setQ(value);
    setActive(0);
    if (timer.current) clearTimeout(timer.current);
    const query = value.trim();
    latestQuery.current = query;
    if (!query) {
      setResults(suggestions);
      return;
    }
    if (query.length < 2) return;
    timer.current = setTimeout(() => {
      startSearch(async () => {
        const result = await searchRecipientsAction(query);
        if (latestQuery.current !== query) return;
        if (result.ok) setResults(result.data);
        else setError(result.error);
      });
    }, 250);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!results.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = results[active];
      if (r) choose(r);
    }
  };

  const send = async (body: string): Promise<boolean> => {
    if (!recipient) return false;
    setError(null);
    const result = await startConversationAction({ recipientId: recipient.id, body, courseId: recipient.courseId, subject: subject.trim() || undefined });
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    toast.success("Message sent");
    announceInboxChange();
    router.push(`/messages/${result.data.conversationId}`);
    return true;
  };

  if (recipient) {
    return (
      <div className="space-y-4">
        <RecipientCard r={recipient} onClear={initialRecipient ? undefined : () => setRecipient(null)} />
        <Field label="Subject" htmlFor="dm-subject" hint="Optional — helps them see what it's about.">
          <Input id="dm-subject" value={subject} maxLength={MESSAGE_LIMITS.subjectMax} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Question about week 2" />
        </Field>
        <FormError message={error} />
        <MessageComposer onSend={send} draftKey={`learnloop:dm-draft:new:${recipient.id}`} autoFocus placeholder={`Write to ${recipient.name.split(" ")[0]}…`} />
      </div>
    );
  }

  const showingSuggestions = !q.trim();
  return (
    <div className="space-y-3">
      <Field label="To" htmlFor="dm-to" hint={staff ? "Search members by name, username or exact email." : "Search the instructors of your courses (and classmates, when the site allows it)."}>
        <Input
          id="dm-to"
          type="search"
          value={q}
          onChange={(e) => onSearch(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type a name…"
          autoComplete="off"
          autoFocus
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-activedescendant={results[active] ? `${listId}-${results[active].id}` : undefined}
          leftAddon={searching ? <Spinner className="size-4" /> : <Icon.Search className="size-4" />}
        />
      </Field>
      <FormError message={error} />
      {showingSuggestions && results.length > 0 && <p className="text-xs font-semibold tracking-wide text-ink-faint uppercase">Your instructors</p>}
      {results.length > 0 ? (
        <ul id={listId} role="listbox" aria-label="People you can message" className="divide-y divide-border overflow-hidden rounded-card border border-border">
          {results.map((r, i) => (
            <li
              key={r.id}
              id={`${listId}-${r.id}`}
              role="option"
              aria-selected={i === active}
              onClick={() => choose(r)}
              onMouseEnter={() => setActive(i)}
              className={cn("flex cursor-pointer items-center gap-3 px-3 py-2.5", i === active ? "bg-surface-2" : "bg-surface-1")}
            >
              <Avatar name={r.name} src={r.avatarUrl} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-medium text-ink">
                  <span className="truncate">{r.name}</span>
                  {r.role && (
                    <Badge tone="accent" size="xs">
                      {r.role}
                    </Badge>
                  )}
                </span>
                <span className="block truncate text-xs text-ink-muted">{r.courseTitle ?? `@${r.username}`}</span>
              </span>
              {r.conversationId && <span className="shrink-0 text-xs text-ink-faint">Open conversation</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-card border border-dashed border-border-strong px-4 py-8 text-center text-sm text-ink-muted">
          {showingSuggestions
            ? staff
              ? "Start typing to find a member."
              : "Enroll in a course to message its instructors."
            : q.trim().length < 2
              ? "Keep typing…"
              : searching
                ? "Searching…"
                : "Nobody you can message matches that name."}
        </p>
      )}
    </div>
  );
}
