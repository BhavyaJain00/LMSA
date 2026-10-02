import { RESOURCE_SCHEMAS, resourceFields, type ResourceSchemaName } from "@/lib/api/resources";
import { Icon } from "@/components/ui/icons";
import { getT } from "@/i18n/server";
import { objectAnchor } from "./anchors";
import { ParamList } from "./param-list";

/** Objects the endpoints return, in the order they are documented. */
export const DOCUMENTED_OBJECTS: readonly ResourceSchemaName[] = [
  "Course",
  "CourseDetail",
  "Chapter",
  "Lesson",
  "User",
  "UserRef",
  "Enrollment",
  "Progress",
  "LessonProgress",
  "Payment",
  "Certificate",
  "Batch",
  "BatchMember",
  "WebhookEndpoint",
  "WebhookEndpointWithSecret",
  "WebhookDelivery",
  "WebhookPayload",
  "WebhookEvent",
  "KeyInfo",
  "Deleted",
];

/** Field reference of every response object, one disclosure each (anchored at `#object-<Name>`). */
export async function ObjectList() {
  const t = await getT("admin");
  return (
    <div className="space-y-2">
      {DOCUMENTED_OBJECTS.map((name) => {
        const schema = RESOURCE_SCHEMAS[name];
        const fields = resourceFields(name).map((field) => ({ ...field, nullable: false, constraints: [], example: null }));
        return (
          <details key={name} id={objectAnchor(name)} className="group scroll-mt-24 rounded-card border border-border bg-surface-1 open:shadow-sm">
            <summary className="flex cursor-pointer list-none items-center gap-3 rounded-card px-3 py-2.5 hover:bg-surface-2/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 sm:px-4 [&::-webkit-details-marker]:hidden">
              <code className="font-mono text-[13px] font-semibold text-ink">{name}</code>
              <span className="flex-1 text-xs text-ink-muted">{t("pages.developers.objects.fieldCount", { count: fields.length })}</span>
              <Icon.ChevronDown className="size-4 shrink-0 text-ink-faint transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="border-t border-border px-3 pb-4 pt-3 sm:px-4">
              {typeof schema.description === "string" && <p className="mb-2 text-sm text-ink-muted">{schema.description}</p>}
              <ParamList title={t("pages.developers.objects.fields")} params={fields} />
            </div>
          </details>
        );
      })}
    </div>
  );
}
