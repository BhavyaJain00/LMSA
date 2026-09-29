"use client";

import { useState } from "react";
import { Field, Select } from "@/components/ui/input";
import {
  CERTIFICATE_TEMPLATE_OPTIONS,
  DEFAULT_CERTIFICATE_TEMPLATE_ID,
  isCertificateTemplateId,
  resolveCertificateTemplate,
  type CertificateTemplateId,
} from "./templates";

/** Tiny schematic of a template's layout, shown next to the picker. */
function TemplateThumbnail({ id }: { id: CertificateTemplateId }) {
  return (
    <span aria-hidden="true" className="relative block h-12 w-17 shrink-0 overflow-hidden rounded-md border border-border bg-surface-1 shadow-card">
      {id === "classic" && (
        <span className="absolute inset-1 flex flex-col items-center justify-center gap-0.5 rounded-sm border-2 border-accent">
          <span className="h-0.5 w-5 rounded-full bg-ink-faint" />
          <span className="h-1 w-8 rounded-full bg-ink" />
          <span className="h-0.5 w-6 rounded-full bg-ink-faint" />
          <span className="mt-0.5 size-1.5 rounded-full bg-accent" />
        </span>
      )}
      {id === "modern" && (
        <span className="absolute inset-0 flex">
          <span className="h-full w-5 bg-accent" />
          <span className="flex flex-1 flex-col justify-center gap-0.5 px-1.5">
            <span className="h-0.5 w-6 rounded-full bg-ink-faint" />
            <span className="h-1 w-8 rounded-full bg-ink" />
            <span className="h-0.5 w-3 rounded-full bg-accent" />
          </span>
        </span>
      )}
      {id === "minimal" && (
        <span className="absolute inset-1.5 flex flex-col justify-between">
          <span className="h-px w-full bg-border-strong" />
          <span className="flex flex-col gap-0.5">
            <span className="h-1 w-9 rounded-full bg-ink" />
            <span className="h-0.5 w-7 rounded-full bg-ink-faint" />
          </span>
          <span className="h-px w-full bg-border-strong" />
        </span>
      )}
    </span>
  );
}

/**
 * "Template" picker for certificate forms. Submits `name` (default
 * "templateId") with a registered template id; defaults to the first template.
 */
export function CertificateTemplateField({
  id,
  name = "templateId",
  defaultValue,
  disabled,
  error,
  className,
}: {
  id: string;
  name?: string;
  defaultValue?: string | null;
  disabled?: boolean;
  error?: string;
  className?: string;
}) {
  const [value, setValue] = useState<CertificateTemplateId>(isCertificateTemplateId(defaultValue) ? defaultValue : DEFAULT_CERTIFICATE_TEMPLATE_ID);
  const template = resolveCertificateTemplate(value);
  return (
    <Field label="Template" htmlFor={id} error={error} className={className}>
      <div className="flex items-center gap-3">
        <TemplateThumbnail id={template.id} />
        <div className="min-w-0 flex-1">
          <Select
            id={id}
            name={name}
            value={value}
            disabled={disabled}
            invalid={!!error}
            onChange={(e) => {
              if (isCertificateTemplateId(e.target.value)) setValue(e.target.value);
            }}
            options={CERTIFICATE_TEMPLATE_OPTIONS}
          />
        </div>
      </div>
      {!error && <p className="mt-1.5 text-xs text-ink-muted">{template.description}</p>}
    </Field>
  );
}
