import type { EndpointDoc } from "@/lib/api/docs";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { objectAnchor } from "./anchors";
import { CodeBlock } from "./code-block";
import { CodeTabs } from "./code-tabs";
import { MethodBadge, StatusCode } from "./method-badge";
import { ParamList } from "./param-list";
import { InlineCode, RichText } from "./rich-text";

/**
 * One endpoint as a disclosure: the summary row (method, path, title) is
 * always visible; parameters, examples and responses open below it. The
 * element's id is the operationId, so `/developers#listCourses` links to it.
 */
export function EndpointCard({ doc }: { doc: EndpointDoc }) {
  const fullPath = `/api/v1${doc.path === "/" ? "" : doc.path}`;
  return (
    <details id={doc.id} className="group scroll-mt-24 rounded-card border border-border bg-surface-1 open:shadow-sm">
      <summary className="flex cursor-pointer list-none items-start gap-3 rounded-card px-3 py-3 hover:bg-surface-2/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 sm:items-center sm:px-4 [&::-webkit-details-marker]:hidden">
        <MethodBadge method={doc.method} className="mt-0.5 sm:mt-0" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
          <code className="font-mono text-[13px] font-medium text-ink break-all">{fullPath}</code>
          <span className="text-sm text-ink-muted sm:truncate">{doc.summary}</span>
        </span>
        <Icon.ChevronDown className="mt-0.5 size-4 shrink-0 text-ink-faint transition-transform group-open:rotate-180 sm:mt-0" aria-hidden="true" />
      </summary>

      <div className="space-y-5 border-t border-border px-3 pb-4 pt-4 sm:px-4">
        <div className="space-y-2 text-sm">
          {doc.description && <RichText text={doc.description} className="block text-ink-muted" />}
          <p className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
            <Icon.Lock className="size-3.5" aria-hidden="true" />
            {doc.scope ? (
              <>
                Needs scope <Badge tone="accent" size="xs">{doc.scope}</Badge>
                <span>{doc.scopeDescription}</span>
              </>
            ) : (
              <span>Any valid API key.</span>
            )}
          </p>
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          <div className="min-w-0 space-y-4">
            <ParamList title="Path parameters" params={doc.params} />
            <ParamList title="Query parameters" params={doc.query} />
            <ParamList title="JSON body" params={doc.body} />
            {doc.bodyRules.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-xs text-ink-muted">
                {doc.bodyRules.map((rule) => (
                  <li key={rule}>
                    <RichText text={rule} />
                  </li>
                ))}
              </ul>
            )}
            {!doc.params.length && !doc.query.length && !doc.body.length && <p className="text-sm text-ink-muted">This endpoint takes no parameters.</p>}
          </div>

          <div className="min-w-0 space-y-4">
            <CodeTabs
              title="Example request"
              samples={[
                { id: "curl", label: "curl", code: doc.curl },
                { id: "js", label: "JavaScript", code: doc.javascript },
              ]}
            />
            <div>
              <p className="mb-1.5 flex flex-wrap items-center gap-2 text-xs font-medium text-ink-muted">
                Example response <StatusCode status={doc.response.status} />
                <span>
                  {doc.response.list ? "a page of " : ""}
                  <a href={`#${objectAnchor(doc.response.resource)}`} className="text-accent hover:underline">
                    {doc.response.resource}
                  </a>
                  {doc.response.list ? " objects" : ""}
                </span>
              </p>
              <CodeBlock code={doc.response.example} label="JSON" />
            </div>
          </div>
        </div>

        <section>
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-ink-faint">Responses</h4>
          <ul className="divide-y divide-border rounded-lg border border-border text-sm">
            {[{ status: doc.response.status, description: doc.response.description }, ...doc.alsoReturns, ...doc.errors].map((response) => (
              <li key={response.status} className="flex gap-3 px-3 py-2">
                <StatusCode status={response.status} className="w-9 shrink-0 pt-px" />
                <RichText text={response.description} className="min-w-0 text-ink-muted" />
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs text-ink-faint">
            Errors use the <InlineCode>{"{ error: { code, message, details } }"}</InlineCode> envelope (see <a href="#errors" className="text-accent hover:underline">Errors</a>).
          </p>
        </section>
      </div>
    </details>
  );
}
