import { Icon } from "@/components/ui/icons";
import { formatLongDate } from "./time";

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

/**
 * The certificate itself: a landscape sheet that scales with its container
 * (container-query units) on tablets/desktop and prints on one A4 page.
 * On narrow phones it falls back to a readable stacked card.
 */
export function CertificateSheet(props: CertificateSheetProps) {
  const { brandName, logoUrl, learnerName, title, kind, issueDate, expiryDate, evaluatorName, instructorNames, code, verifyUrl } = props;
  const signerLabel = evaluatorName ? "Evaluated By" : instructorNames.length > 1 ? "Instructors" : "Instructor";
  const signer = evaluatorName ?? (instructorNames.length ? instructorNames.join(", ") : brandName);

  return (
    <article className="certificate-sheet @container mx-auto w-full max-w-5xl overflow-hidden rounded-2xl bg-surface-1 shadow-pop" aria-label={`Certificate for ${learnerName}`}>
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
    </article>
  );
}
