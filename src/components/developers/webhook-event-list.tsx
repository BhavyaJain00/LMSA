import type { DocParam } from "@/lib/api/docs";
import { WEBHOOK_EXPANSIONS, type WebhookEventDoc, type WebhookFieldDoc } from "@/lib/webhooks/events";
import { Icon } from "@/components/ui/icons";
import { eventAnchor } from "./anchors";
import { CodeBlock } from "./code-block";
import { ParamList } from "./param-list";
import { InlineCode } from "./rich-text";
import { getT } from "@/i18n/server";

type FieldRow = Pick<DocParam, "name" | "type" | "required" | "nullable" | "description" | "values" | "constraints" | "example">;

function fieldRow(field: WebhookFieldDoc): FieldRow {
  return {
    name: field.name,
    type: field.type,
    required: !field.optional,
    nullable: !!field.nullable,
    description: field.description,
    values: field.enum ? [...field.enum] : null,
    constraints: [],
    example: null,
  };
}

/** The `data` fields of an event, followed by the related records added next to their ids. */
function dataRows(event: WebhookEventDoc): FieldRow[] {
  const rows = event.fields.map(fieldRow);
  for (const expansion of WEBHOOK_EXPANSIONS) {
    const idField = event.fields.find((field) => field.name === expansion.idField);
    if (!idField) continue;
    rows.push({
      name: expansion.field,
      type: `object { ${expansion.fields.map((field) => field.name).join(", ")} }`,
      required: !idField.optional,
      nullable: true,
      description: `${expansion.description} Added next to \`${expansion.idField}\`; null when the record no longer exists.`,
      values: null,
      constraints: [],
      example: null,
    });
  }
  return rows;
}

/** The event catalog: one disclosure per event with its fields and an example request body. */
export async function WebhookEventList({ events, examples }: { events: readonly WebhookEventDoc[]; examples: Readonly<Record<string, string>> }) {
  const t = await getT("admin");
  return (
    <div className="space-y-2">
      {events.map((event) => (
        <details key={event.name} id={eventAnchor(event.name)} className="group scroll-mt-24 rounded-card border border-border bg-surface-1 open:shadow-sm">
          <summary className="flex cursor-pointer list-none items-start gap-3 rounded-card px-3 py-3 hover:bg-surface-2/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 sm:items-center sm:px-4 [&::-webkit-details-marker]:hidden">
            <Icon.Zap className="mt-0.5 size-4 shrink-0 text-accent sm:mt-0" aria-hidden="true" />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
              <code dir="ltr" className="font-mono text-[13px] font-medium text-ink">{event.name}</code>
              <span className="text-sm text-ink-muted sm:truncate">{event.description}</span>
            </span>
            <Icon.ChevronDown className="mt-0.5 size-4 shrink-0 text-ink-faint transition-transform group-open:rotate-180 sm:mt-0" aria-hidden="true" />
          </summary>
          <div className="grid gap-5 border-t border-border px-3 pb-4 pt-4 sm:px-4 xl:grid-cols-2">
            <div className="min-w-0">
              <ParamList title={t("pages.developers.events.fields", { label: event.label })} params={dataRows(event)} />
            </div>
            <div className="min-w-0">
              <p className="mb-1.5 text-xs font-medium text-ink-muted">
                {t.rich("pages.developers.events.example", { code: (chunks) => <InlineCode>{chunks}</InlineCode> })}
              </p>
              <CodeBlock code={examples[event.name] ?? "{}"} label="JSON" />
            </div>
          </div>
        </details>
      ))}
    </div>
  );
}
