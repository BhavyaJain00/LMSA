"use client";

import type { DocParam } from "@/lib/api/docs";
import { useT } from "@/i18n/client";
import { Badge } from "@/components/ui/badge";
import { InlineCode, RichText } from "./rich-text";

/**
 * Parameters or fields as a stacked list (readable at 375px, unlike a
 * wide table): name, type, required flag, description, allowed values and
 * limits.
 */
export function ParamList({ title, params }: { title: string; params: readonly Pick<DocParam, "name" | "type" | "required" | "nullable" | "description" | "values" | "constraints" | "example">[] }) {
  const t = useT("admin");
  if (!params.length) return null;
  return (
    <section>
      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-ink-faint">{title}</h4>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {params.map((param) => (
          <li key={param.name} className="px-3 py-2.5 text-sm">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <code dir="ltr" className="font-mono text-[13px] font-semibold text-ink break-all">{param.name}</code>
              <span className="font-mono text-xs text-ink-muted">
                {param.type}
                {param.nullable ? " | null" : ""}
              </span>
              {param.required ? (
                <Badge tone="danger" size="xs">
                  {t("developers.params.required")}
                </Badge>
              ) : (
                <Badge tone="neutral" size="xs">
                  {t("developers.params.optional")}
                </Badge>
              )}
            </div>
            {param.description && <RichText text={param.description} className="mt-1 block text-ink-muted" />}
            {(param.values?.length || param.constraints.length || param.example) && (
              <dl className="mt-1.5 space-y-1 text-xs text-ink-muted">
                {param.values && param.values.length > 0 && (
                  <div className="flex flex-wrap items-baseline gap-1">
                    <dt className="font-medium text-ink">{t("developers.params.oneOf")}</dt>
                    {param.values.map((value) => (
                      <dd key={value}>
                        <InlineCode>{value}</InlineCode>
                      </dd>
                    ))}
                  </div>
                )}
                {param.constraints.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    <dt className="font-medium text-ink">{t("developers.params.limits")}</dt>
                    <dd>{param.constraints.join(", ")}</dd>
                  </div>
                )}
                {param.example && (
                  <div className="flex flex-wrap items-baseline gap-1">
                    <dt className="font-medium text-ink">{t("developers.params.example")}</dt>
                    <dd className="min-w-0 break-all">
                      <InlineCode>{param.example.length > 120 ? `${param.example.slice(0, 117)}…` : param.example}</InlineCode>
                    </dd>
                  </div>
                )}
              </dl>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
