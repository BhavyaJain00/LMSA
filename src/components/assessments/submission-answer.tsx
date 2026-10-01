import type { AssignmentType } from "@/lib/types";
import { Markdown } from "@/lib/markdown";
import { Icon } from "@/components/ui/icons";
import { fileNameFromUrl, isImageUrl, isPdfUrl } from "./shared";

/** Renders a learner's answer for reviewers: markdown text, a link, or the uploaded file with a preview. */
export function SubmissionAnswer({ type, answer, attachmentUrl }: { type: AssignmentType; answer?: string; attachmentUrl?: string }) {
  if (type === "text") {
    return answer ? (
      <div className="rounded-xl border border-border bg-surface-2/40 px-4 py-3">
        <Markdown content={answer} />
      </div>
    ) : (
      <p className="text-sm italic text-ink-muted">No answer was written.</p>
    );
  }
  if (type === "url") {
    return answer ? (
      <a
        href={answer}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 rounded-xl border border-border bg-surface-1 px-3 py-2.5 text-sm transition-colors hover:bg-surface-2"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2 text-ink-muted">
          <Icon.Link className="size-4" />
        </span>
        <span className="min-w-0 flex-1 break-all font-medium text-accent">{answer}</span>
        <Icon.ExternalLink className="size-4 shrink-0 text-ink-faint" />
      </a>
    ) : (
      <p className="text-sm italic text-ink-muted">No link was submitted.</p>
    );
  }
  if (!attachmentUrl) return <p className="text-sm italic text-ink-muted">No file was uploaded.</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-1 px-3 py-2.5 text-sm">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2 text-ink-muted">
          <Icon.FileText className="size-4" />
        </span>
        <span className="min-w-0 flex-1 truncate font-medium text-ink">{fileNameFromUrl(attachmentUrl)}</span>
        <a href={attachmentUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
          Open <Icon.ExternalLink className="size-3.5" />
        </a>
        <a href={attachmentUrl} download className="inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink">
          <Icon.Download className="size-3.5" /> Download
        </a>
      </div>
      {isImageUrl(attachmentUrl) && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={attachmentUrl} alt="Submitted file" className="max-h-[32rem] w-auto rounded-xl border border-border object-contain" />
      )}
      {isPdfUrl(attachmentUrl) && (
        // The browser's built-in PDF viewer; the "Open" and "Download" links above are the fallback.
        <iframe src={attachmentUrl} title="Submitted PDF" loading="lazy" className="h-[32rem] w-full rounded-xl border border-border bg-surface-2" />
      )}
    </div>
  );
}
