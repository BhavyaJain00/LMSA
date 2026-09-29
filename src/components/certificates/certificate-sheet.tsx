import type { ReactNode } from "react";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { formatLongDate } from "./time";
import { resolveCertificateTemplate } from "./templates";

export interface CertificateSheetProps {
  brandName: string;
  logoUrl?: string;
  learnerName: string;
  /** Course or batch title. */
  title: string;
  kind: "course" | "batch";
  issueDate: string;
  expiryDate?: string | null;
  evaluatorName?: string | null;
  instructorNames: string[];
  code: string;
  verifyUrl: string;
  /** Certificate template id (see templates.ts); unknown or missing ids use the default template. */
  templateId?: string | null;
}

function Seal() {
  return (
    <svg viewBox="0 0 120 120" className="size-full" aria-hidden="true">
      <defs>
        <path id="seal-circle" d="M60,60 m-43,0 a43,43 0 1,1 86,0 a43,43 0 1,1 -86,0" />
      </defs>
      <circle cx="60" cy="60" r="57" strokeWidth="2" style={{ fill: "none", stroke: "var(--accent)" }} />
      <circle cx="60" cy="60" r="52" strokeWidth="1" strokeDasharray="2 3" style={{ fill: "color-mix(in srgb, var(--accent) 10%, transparent)", stroke: "var(--accent)" }} />
      <circle cx="60" cy="60" r="32" style={{ fill: "var(--accent)" }} />
      <path d="M47 60.5 56 69l17-18" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" style={{ fill: "none", stroke: "var(--accent-fg)" }} />
      <text fontSize="9" fontWeight="700" letterSpacing="2.4" style={{ fill: "var(--accent)" }}>
        <textPath href="#seal-circle" startOffset="0">
          VERIFIED · CERTIFIED · VERIFIED · CERTIFIED ·
        </textPath>
      </text>
    </svg>
  );
}

function signerOf({ evaluatorName, instructorNames, brandName }: CertificateSheetProps): { signer: string; signerLabel: string } {
  return {
    signerLabel: evaluatorName ? "Evaluated By" : instructorNames.length > 1 ? "Instructors" : "Instructor",
    signer: evaluatorName ?? (instructorNames.length ? instructorNames.join(", ") : brandName),
  };
}

/** Shared outer sheet: sizes for screen and print (see certificate-print.css). */
function SheetFrame({ learnerName, templateId, children }: { learnerName: string; templateId: string; children: ReactNode }) {
  return (
    <article
      className="certificate-sheet @container mx-auto w-full max-w-5xl overflow-hidden rounded-2xl bg-surface-1 shadow-pop"
      aria-label={`Certificate for ${learnerName}`}
      data-template={templateId}
    >
      {children}
    </article>
  );
}

function BrandMark({ brandName, logoUrl, inverted, className }: { brandName: string; logoUrl?: string; inverted?: boolean; className?: string }) {
  return (
    <div className={className}>
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" className="h-10 w-auto object-contain @2xl:h-[4cqw]" />
      ) : (
        <span
          className={cn(
            "flex size-10 items-center justify-center rounded-xl @2xl:size-[4cqw] @2xl:rounded-[0.9cqw]",
            inverted ? "bg-accent-fg/15 text-accent-fg" : "bg-accent text-accent-fg",
          )}
        >
          <Icon.GraduationCap className="size-6 @2xl:size-[2.5cqw]" />
        </span>
      )}
      <span className={cn("text-lg font-bold tracking-tight @2xl:text-[2cqw]", inverted ? "text-accent-fg" : "text-ink")}>{brandName}</span>
    </div>
  );
}

/** "Classic": framed, centered, serif learner name and a verification seal. */
function ClassicSheet(props: CertificateSheetProps) {
  const { brandName, logoUrl, learnerName, title, kind, issueDate, expiryDate, code, verifyUrl } = props;
  const { signer, signerLabel } = signerOf(props);

  return (
    <SheetFrame learnerName={learnerName} templateId="classic">
      <div className="relative @2xl:aspect-[297/210]">
        <div className="m-3 rounded-xl border-[6px] border-accent p-1 @2xl:absolute @2xl:inset-[2.2cqw] @2xl:m-0 @2xl:border-[0.75cqw] @2xl:p-[0.5cqw]">
          <div className="flex h-full flex-col items-center rounded-lg border border-accent/30 px-5 py-8 text-center @2xl:px-[6cqw] @2xl:py-[3.2cqw]">
            {/* Brand */}
            <div className="flex items-center gap-2.5 @2xl:gap-[1cqw]">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="" className="h-10 w-auto object-contain @2xl:h-[4.4cqw]" />
              ) : (
                <span className="flex size-10 items-center justify-center rounded-xl bg-accent text-accent-fg @2xl:size-[4.4cqw] @2xl:rounded-[1cqw]">
                  <Icon.GraduationCap className="size-6 @2xl:size-[2.8cqw]" />
                </span>
              )}
              <span className="text-xl font-extrabold tracking-tight text-ink @2xl:text-[2.4cqw]">{brandName}</span>
            </div>

            <p className="mt-6 text-xs font-semibold uppercase tracking-[0.3em] text-accent @2xl:mt-[3.4cqw] @2xl:text-[1.25cqw]">
              Certificate of {kind === "batch" ? "Achievement" : "Completion"}
            </p>
            <p className="mt-4 text-sm text-ink-muted @2xl:mt-[2.4cqw] @2xl:text-[1.6cqw]">This is to certify that</p>
            <h1 className="mt-2 font-serif text-3xl font-bold tracking-tight text-ink @2xl:mt-[1cqw] @2xl:text-[4.6cqw] @2xl:leading-tight">{learnerName}</h1>
            <div className="mx-auto mt-3 h-px w-40 bg-accent/40 @2xl:mt-[1.4cqw] @2xl:w-[36cqw]" aria-hidden="true" />
            <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-ink-muted @2xl:mt-[1.8cqw] @2xl:max-w-[68cqw] @2xl:text-[1.65cqw]">
              has successfully completed the <strong className="font-semibold text-ink">{title}</strong> {kind === "batch" ? "batch" : "course"} including all required
              assessments on <span className="font-medium text-ink">{formatLongDate(issueDate)}</span>.
            </p>

            {/* Footer: dates · seal · signer */}
            <div className="mt-8 grid w-full grid-cols-1 items-end gap-6 @md:grid-cols-3 @2xl:mt-auto @2xl:gap-[2cqw]">
              <div className="text-center @md:text-left">
                <p className="text-[11px] uppercase tracking-wider text-ink-faint @2xl:text-[1cqw]">Issued on</p>
                <p className="mt-0.5 text-sm font-semibold text-ink @2xl:text-[1.5cqw]">{formatLongDate(issueDate)}</p>
                {expiryDate && (
                  <>
                    <p className="mt-2 text-[11px] uppercase tracking-wider text-ink-faint @2xl:mt-[0.8cqw] @2xl:text-[1cqw]">Valid until</p>
                    <p className="mt-0.5 text-sm font-semibold text-ink @2xl:text-[1.5cqw]">{formatLongDate(expiryDate)}</p>
                  </>
                )}
              </div>
              <div className="mx-auto size-24 @2xl:size-[11cqw]">
                <Seal />
              </div>
              <div className="text-center @md:text-right">
                <p className="font-serif text-lg italic text-ink @2xl:text-[2cqw]">{signer}</p>
                <div className="my-1 ml-auto mr-auto h-px w-40 bg-border-strong @md:mr-0 @2xl:w-[20cqw]" aria-hidden="true" />
                <p className="text-[11px] uppercase tracking-wider text-ink-faint @2xl:text-[1cqw]">{signerLabel}</p>
              </div>
            </div>

            <p className="mt-6 break-all text-[10px] text-ink-faint @2xl:mt-[2cqw] @2xl:text-[0.95cqw]">
              Certificate ID <span className="font-mono font-medium text-ink-muted">{code}</span> · Verify at {verifyUrl}
            </p>
          </div>
        </div>
      </div>
    </SheetFrame>
  );
}

/** "Modern": accent side panel with brand, seal and ID; bold sans-serif details on the right. */
function ModernSheet(props: CertificateSheetProps) {
  const { brandName, logoUrl, learnerName, title, kind, issueDate, expiryDate, code, verifyUrl } = props;
  const { signer, signerLabel } = signerOf(props);
  return (
    <SheetFrame learnerName={learnerName} templateId="modern">
      <div className="flex flex-col @2xl:aspect-[297/210] @2xl:flex-row">
        {/* Accent panel */}
        <aside className="flex flex-col gap-6 bg-accent px-6 py-7 text-accent-fg @2xl:w-[31%] @2xl:justify-between @2xl:gap-0 @2xl:px-[3.4cqw] @2xl:py-[4cqw]">
          <BrandMark brandName={brandName} logoUrl={logoUrl} inverted className="flex items-center gap-2.5 @2xl:flex-col @2xl:items-start @2xl:gap-[1.2cqw]" />
          <div>
            <p className="text-3xl font-black uppercase leading-none tracking-tight @2xl:text-[4.6cqw]">Certificate</p>
            <p className="mt-2 text-sm font-medium uppercase tracking-[0.25em] opacity-80 @2xl:mt-[1cqw] @2xl:text-[1.2cqw]">
              of {kind === "batch" ? "Achievement" : "Completion"}
            </p>
          </div>
          <div className="hidden size-[9cqw] rounded-full border-[0.35cqw] border-accent-fg/60 p-[0.6cqw] @2xl:block" aria-hidden="true">
            <div className="flex size-full items-center justify-center rounded-full bg-accent-fg/15">
              <Icon.Check className="size-[4.2cqw]" />
            </div>
          </div>
          <div className="text-xs opacity-90 @2xl:text-[1cqw]">
            <p className="uppercase tracking-wider opacity-80">Certificate ID</p>
            <p className="mt-0.5 font-mono text-sm font-semibold @2xl:text-[1.4cqw]">{code}</p>
          </div>
        </aside>

        {/* Details */}
        <div className="flex flex-1 flex-col px-6 py-8 @2xl:px-[5cqw] @2xl:py-[4.4cqw]">
          <p className="text-sm font-medium text-ink-muted @2xl:text-[1.6cqw]">This certificate is proudly presented to</p>
          <h1 className="mt-2 text-3xl font-extrabold leading-tight tracking-tight text-ink @2xl:mt-[1.2cqw] @2xl:text-[5cqw]">{learnerName}</h1>
          <div className="mt-4 h-1.5 w-16 rounded-full bg-accent @2xl:mt-[2cqw] @2xl:h-[0.6cqw] @2xl:w-[8cqw]" aria-hidden="true" />
          <p className="mt-5 text-sm leading-relaxed text-ink-muted @2xl:mt-[2.4cqw] @2xl:text-[1.7cqw]">for successfully completing the {kind === "batch" ? "batch" : "course"}</p>
          <p className="mt-1 text-xl font-bold tracking-tight text-ink @2xl:mt-[0.6cqw] @2xl:text-[2.8cqw]">{title}</p>
          <p className="mt-2 text-sm text-ink-muted @2xl:mt-[0.8cqw] @2xl:text-[1.5cqw]">including all required assessments.</p>

          <dl className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-3 @2xl:mt-auto @2xl:gap-[2.4cqw]">
            <div className="border-t-2 border-accent pt-2 @2xl:border-t-[0.3cqw] @2xl:pt-[0.9cqw]">
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint @2xl:text-[1cqw]">Issued on</dt>
              <dd className="mt-0.5 text-sm font-semibold text-ink @2xl:text-[1.5cqw]">{formatLongDate(issueDate)}</dd>
            </div>
            <div className="border-t-2 border-border-strong pt-2 @2xl:border-t-[0.3cqw] @2xl:pt-[0.9cqw]">
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint @2xl:text-[1cqw]">Valid until</dt>
              <dd className="mt-0.5 text-sm font-semibold text-ink @2xl:text-[1.5cqw]">{expiryDate ? formatLongDate(expiryDate) : "No expiry"}</dd>
            </div>
            <div className="border-t-2 border-border-strong pt-2 @2xl:border-t-[0.3cqw] @2xl:pt-[0.9cqw]">
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint @2xl:text-[1cqw]">{signerLabel}</dt>
              <dd className="mt-0.5 text-sm font-semibold text-ink @2xl:text-[1.5cqw]">{signer}</dd>
            </div>
          </dl>
          <p className="mt-6 break-all text-[10px] text-ink-faint @2xl:mt-[2cqw] @2xl:text-[0.95cqw]">Verify at {verifyUrl}</p>
        </div>
      </div>
    </SheetFrame>
  );
}

/** "Minimal": left-aligned typography, hairline rules, no seal; monochrome-friendly. */
function MinimalSheet(props: CertificateSheetProps) {
  const { brandName, logoUrl, learnerName, title, kind, issueDate, expiryDate, code, verifyUrl } = props;
  const { signer, signerLabel } = signerOf(props);
  return (
    <SheetFrame learnerName={learnerName} templateId="minimal">
      <div className="relative @2xl:aspect-[297/210]">
        <div className="flex h-full flex-col px-6 py-8 @2xl:absolute @2xl:inset-0 @2xl:px-[7cqw] @2xl:py-[5.5cqw]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-strong pb-4 @2xl:pb-[1.6cqw]">
            <BrandMark brandName={brandName} logoUrl={logoUrl} className="flex items-center gap-2.5 @2xl:gap-[1cqw]" />
            <p className="text-[11px] uppercase tracking-[0.3em] text-ink-faint @2xl:text-[1.05cqw]">Certificate of {kind === "batch" ? "Achievement" : "Completion"}</p>
          </div>

          <div className="py-8 @2xl:my-auto @2xl:py-0">
            <p className="text-sm text-ink-muted @2xl:text-[1.6cqw]">Awarded to</p>
            <h1 className="mt-2 text-3xl font-light tracking-tight text-ink @2xl:mt-[0.8cqw] @2xl:text-[5.4cqw] @2xl:leading-none">{learnerName}</h1>
            <p className="mt-5 max-w-2xl text-sm leading-relaxed text-ink-muted @2xl:mt-[2.6cqw] @2xl:max-w-[70cqw] @2xl:text-[1.7cqw]">
              for completing the {kind === "batch" ? "batch" : "course"} <span className="font-semibold text-ink">{title}</span>, including all required assessments.
            </p>
          </div>

          <dl className="grid grid-cols-2 gap-4 border-t border-border-strong pt-4 text-left sm:grid-cols-4 @2xl:gap-[2cqw] @2xl:pt-[1.6cqw]">
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-ink-faint @2xl:text-[0.95cqw]">Issued</dt>
              <dd className="mt-0.5 text-sm text-ink @2xl:text-[1.4cqw]">{formatLongDate(issueDate)}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-ink-faint @2xl:text-[0.95cqw]">Valid until</dt>
              <dd className="mt-0.5 text-sm text-ink @2xl:text-[1.4cqw]">{expiryDate ? formatLongDate(expiryDate) : "No expiry"}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-ink-faint @2xl:text-[0.95cqw]">{signerLabel}</dt>
              <dd className="mt-0.5 text-sm text-ink @2xl:text-[1.4cqw]">{signer}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-ink-faint @2xl:text-[0.95cqw]">Certificate ID</dt>
              <dd className="mt-0.5 break-all font-mono text-sm text-ink @2xl:text-[1.4cqw]">{code}</dd>
            </div>
          </dl>
          <p className="mt-3 break-all text-[10px] text-ink-faint @2xl:mt-[1.2cqw] @2xl:text-[0.95cqw]">Verify at {verifyUrl}</p>
        </div>
      </div>
    </SheetFrame>
  );
}

/**
 * The certificate itself: a landscape sheet that scales with its container
 * (container-query units) on tablets/desktop and prints on one A4 page.
 * On narrow phones it falls back to a readable stacked card. The layout
 * comes from the certificate's template (default: the first template).
 */
export function CertificateSheet(props: CertificateSheetProps) {
  const template = resolveCertificateTemplate(props.templateId);
  if (template.id === "modern") return <ModernSheet {...props} />;
  if (template.id === "minimal") return <MinimalSheet {...props} />;
  return <ClassicSheet {...props} />;
}
