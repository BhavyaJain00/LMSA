/**
 * Certificate template registry (Frappe: Print Formats for LMS Certificate).
 * A certificate stores the chosen template id in `Certificate.templateId`;
 * `CertificateSheet` renders the matching print design. Certificates without
 * a template, or with an id that is no longer registered, use the first
 * (default) template. Client-safe: no runtime dependencies.
 */

export type CertificateTemplateId = "classic" | "modern" | "minimal";

export interface CertificateTemplate {
  id: CertificateTemplateId;
  name: string;
  description: string;
}

export const CERTIFICATE_TEMPLATES: readonly CertificateTemplate[] = [
  {
    id: "classic",
    name: "Classic",
    description: "Framed landscape sheet with a serif name, centered text and a verification seal.",
  },
  {
    id: "modern",
    name: "Modern",
    description: "Bold accent side panel with the brand and certificate ID, clean sans-serif details.",
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "Understated, left-aligned layout with hairline rules and no seal. Prints well in black and white.",
  },
] as const;

export const DEFAULT_CERTIFICATE_TEMPLATE_ID: CertificateTemplateId = CERTIFICATE_TEMPLATES[0]!.id;

export function isCertificateTemplateId(value: unknown): value is CertificateTemplateId {
  return typeof value === "string" && CERTIFICATE_TEMPLATES.some((t) => t.id === value);
}

/** The template to render for a stored id (falls back to the default template). */
export function resolveCertificateTemplate(id: string | null | undefined): CertificateTemplate {
  return CERTIFICATE_TEMPLATES.find((t) => t.id === id) ?? CERTIFICATE_TEMPLATES[0]!;
}

/** Options for the "Template" select in the issue, bulk-issue and evaluation forms. */
export const CERTIFICATE_TEMPLATE_OPTIONS: { value: CertificateTemplateId; label: string }[] = CERTIFICATE_TEMPLATES.map((t) => ({
  value: t.id,
  label: t.id === DEFAULT_CERTIFICATE_TEMPLATE_ID ? `${t.name} (default)` : t.name,
}));
