"use client";

import { useState } from "react";
import { WEBHOOK_EVENTS, WEBHOOK_EVENT_NAMES } from "@/lib/webhooks/events";
import { MAX_WEBHOOK_DESCRIPTION_LENGTH, MAX_WEBHOOK_URL_LENGTH } from "@/lib/webhooks/policy";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input } from "@/components/ui/input";

/**
 * URL, description and event checklist of a webhook endpoint, shared by the
 * "Add endpoint" and "Edit endpoint" dialogs. Values are read from the
 * surrounding form (`url`, `description`, `events`).
 */
export function WebhookFields({
  idPrefix,
  initial,
  errors,
}: {
  idPrefix: string;
  initial?: { url: string; description: string; events: readonly string[] };
  errors: Record<string, string>;
}) {
  const [events, setEvents] = useState<Set<string>>(() => new Set(initial?.events ?? []));
  const toggle = (name: string, on: boolean) =>
    setEvents((current) => {
      const next = new Set(current);
      if (on) next.add(name);
      else next.delete(name);
      return next;
    });

  return (
    <div className="space-y-5">
      <Field
        label="Endpoint URL"
        htmlFor={`${idPrefix}-url`}
        required
        error={errors.url}
        hint="A public https:// address that answers with a 2xx status within 10 seconds. Redirects are not followed."
      >
        <Input
          id={`${idPrefix}-url`}
          name="url"
          type="url"
          inputMode="url"
          defaultValue={initial?.url}
          maxLength={MAX_WEBHOOK_URL_LENGTH}
          placeholder="https://example.com/webhooks/learnloop"
          autoComplete="off"
          spellCheck={false}
          invalid={!!errors.url}
          required
        />
      </Field>
      <Field label="Description" htmlFor={`${idPrefix}-description`} error={errors.description} hint="What receives these events, so you know what breaks if you remove it.">
        <Input
          id={`${idPrefix}-description`}
          name="description"
          defaultValue={initial?.description}
          maxLength={MAX_WEBHOOK_DESCRIPTION_LENGTH}
          placeholder="e.g. Zapier: new sales to the CRM"
          autoComplete="off"
          invalid={!!errors.description}
        />
      </Field>

      <fieldset>
        <legend className="text-sm font-medium text-ink">
          Events to send <span className="text-danger">*</span>
        </legend>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button size="xs" variant="outline" onClick={() => setEvents(new Set(WEBHOOK_EVENT_NAMES))}>
            Select all
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setEvents(new Set())}>
            Clear
          </Button>
          <span className="text-xs text-ink-muted" aria-live="polite">
            {events.size} of {WEBHOOK_EVENT_NAMES.length} selected
          </span>
        </div>
        <div className="mt-3 grid gap-x-4 gap-y-3 sm:grid-cols-2">
          {WEBHOOK_EVENTS.map((event) => (
            <Checkbox
              key={event.name}
              id={`${idPrefix}-event-${event.name.replace(".", "-")}`}
              name="events"
              value={event.name}
              checked={events.has(event.name)}
              onChange={(e) => toggle(event.name, e.currentTarget.checked)}
              label={<code className="text-xs">{event.name}</code>}
              description={event.description}
            />
          ))}
        </div>
        {errors.events && (
          <p className="mt-2 text-xs text-danger" role="alert">
            {errors.events}
          </p>
        )}
      </fieldset>
    </div>
  );
}
